"""
evaluate.py
TSYP 14 Track 1: Secure Ground-Link Testbed
Digital twin, the seeded evaluation: the three tiers and the decision rule against eight
downlink attacks, two below-the-gate jams and three uplink threats, on TerraSAR-X passes over
Zaghouan.

Protocol, per seed (the report uses seeds 1 to 6):
- train the statistical layer on 3,000 nominal measurements, one a second over the first
  passes after the element set's epoch;
- stream the passes that follow, one packet a second while the link is up: 6,000 held-out
  nominal packets interleaved with 400 attack bursts (50 per attack, 30 packets each);
- then 50 bursts of each below-the-gate jam, and 50 telecommands under each uplink threat.

Each packet goes through the three tiers:
- data: HMAC-SHA256 tag and SHA-256 digest (crypto_hash_verifier.py), then the anti-replay
  window on the CCSDS sequence count (trust_anchor.py's ReplayWindow);
- statistical: the Isolation Forest (isolation_forest_detector.py);
- physical: the chi-square against SGP4 and the ITU-R P.618 link budget, and the kinematic
  coupling of range and Doppler (security_detector.py);
and the decision: either deterministic tier rejects, the statistical tier alone holds, two tiers
at once quarantine the link. A packet is delivered to the analyst only when no tier flags it.

The attacks: the four of the live dashboard (frequency hijacking, stealth spoofing, noise
jamming, data tampering), and four of the Python cores: replay, relay and delay
(groundlink/attacks.py) and injection (the twin's CCSDS sequence hijack).

Everything is seeded and offline (the built-in element set), so a run is reproducible.

Run: python -m digital_twin.evaluate [--seeds 1 2 3 4 5 6] [--json results.json]
"""

from __future__ import annotations

import argparse
import copy
import json
import logging
import math
import resource
import statistics
import sys
import time
from collections import deque
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from testbed.ingester import ROGUE_NODE_TOKEN
from testbed.trust_anchor import ReplayWindow

from .attack_injector import (
    HIJACK_SEQUENCE_JUMP,
    MEACONING_GAIN_DB,
    MEACONING_RANGE_INFLATION_KM,
)
from .ccsds_framing import SEQUENCE_MODULO
from .crypto_hash_verifier import CryptoIntegrityVerifier, sha256_digest
from .ephemeris_loader import EphemerisLoader
from .physics_validator import MasterTelemetryValidator

SPEED_OF_LIGHT_KM_S = 299_792.458

#: The four attacks of the live dashboard, then four of the Python cores.
ATTACKS = (
    "FREQUENCY_HIJACKING",
    "STEALTH_SPOOFING",
    "NOISE_JAMMING",
    "DATA_TAMPERING",
    "REPLAY",
    "RELAY",
    "DELAY",
    "INJECTION",
)
#: Noise below the chi-square gate: the dashboard's demo jam, and the edge of the stealth budget.
EVASION = {"JAM_BELOW_GATE_DEMO": -12.8, "JAM_AT_STEALTH_LIMIT": -5.334}
UPLINK = ("COMMAND_TAMPERING", "COMMAND_INJECTION", "COMMAND_REPLAY")
OUTCOMES = ("DELIVERED", "HELD", "REJECTED", "QUARANTINED")

#: Dashboard constants (dashboard/src/sim/signals.ts, linkFacts.ts).
HIJACK_OFFSET_HZ = 14.2e6
HIJACK_SWEEP_HZ = 0.35e6
HIJACK_EXCESS_DB = 9.0
SPOOF_POWER_DROP_DB = 3.2
SPOOF_DOPPLER_ERROR_HZ = 30.0
JAM_TO_NOISE_DB = 9.1
JAMMED_POWER_DBM = -96.5
JAM_LOCK_LOSS_HZ = 0.8e6
#: groundlink/attacks.py: replayed frames recorded at least this long before, frames held back.
REPLAY_AGE_S = (60.0, 180.0)
DELAY_S = 0.080


def snr_loss_db(jam_to_noise_db: float) -> float:
    """SNR lost when noise J/N dB above the thermal floor is added: 10 log10(1 + J/N)."""
    return 10.0 * math.log10(1.0 + 10.0 ** (jam_to_noise_db / 10.0))


class SequenceFreshness:
    """trust_anchor.py's anti-replay window on the 14-bit CCSDS sequence count, unwrapped."""

    def __init__(self, size: int = 64):
        self.window = ReplayWindow(size)
        self.high: int | None = None

    def unwrap(self, count: int) -> int:
        if self.high is None:
            return count
        delta = (count - self.high) % SEQUENCE_MODULO
        if delta > SEQUENCE_MODULO // 2:
            delta -= SEQUENCE_MODULO
        return self.high + delta

    def fresh(self, count: int) -> bool:
        """Read-only check, so that a frame another tier rejects does not consume its count."""
        seq = self.unwrap(count)
        w = self.window
        return not (seq <= w.high - w.size or seq in w.seen)

    def accept(self, count: int) -> None:
        seq = self.unwrap(count)
        self.window.accept(seq)
        self.high = self.window.high


class Run:
    """One seeded run: the twin's validator, the attacker's state and the counters."""

    def __init__(self, seed: int, n_train: int):
        logging.disable(logging.CRITICAL)
        self.seed = seed
        self.tle = EphemerisLoader().builtin()
        self.v = MasterTelemetryValidator(seed=seed, tle=self.tle, training_passes=1)
        self.rng = np.random.default_rng(1000 + seed)
        self.attacker = CryptoIntegrityVerifier(self.rng.bytes(32))
        self.freshness = SequenceFreshness()
        self.recorded: deque = deque(maxlen=400)
        self.clock = self.tle["epoch_unix"]
        self.ticks = self._ticks()
        self._train(n_train)

    # ---------------------------------------------------------------- the passes

    def _ticks(self):
        """Every second the link is up, pass after pass."""
        while True:
            found = self.v.next_pass(self.clock)
            for t in np.arange(found["aos_unix"], found["los_unix"], 1.0):
                vis, link = self.v.true_link(float(t))
                if vis["is_above_horizon"]:
                    yield float(t), vis, link
            self.clock = found["los_unix"] + 60.0

    def _train(self, n: int) -> None:
        samples = []
        for _ in range(n):
            _, vis, link = next(self.ticks)
            samples.append(self.v.measure(link, vis["elevation_deg"]))
        self.v.ml_detector.fit(samples)

    # ---------------------------------------------------------------- one packet

    def packet(self, attack: str, k: int, jam_to_noise_db: float | None = None) -> dict:
        v = self.v
        t, vis, true_link = next(self.ticks)
        el = vis["elevation_deg"]
        sealed = v.crypto.seal_packet(
            v.framer.build_telemetry_packet(v.sequence % SEQUENCE_MODULO, v.telemetry_payload(t), t)
        )
        v.sequence += 1
        measured = v.measure(true_link, el)
        if attack == "NONE":
            self.recorded.append((t, sealed, dict(measured)))
        link, pkt = self._attack(attack, k, t, measured, sealed, jam_to_noise_db)

        t0 = time.perf_counter()
        crypto = v.crypto.verify_packet_integrity(pkt)
        fresh = self.freshness.fresh(pkt["ccsds_header"]["sequence_count"])
        ml = v.ml_detector.evaluate_packet(link)
        physics = v.physics_engine.evaluate_telemetry_physics(link, true_link, el, t)
        data_flag = not crypto["integrity_passed"] or not fresh
        flags = {
            "data": data_flag,
            "statistical": ml["threat_detected"],
            "physical": physics["physical_breach_detected"],
        }
        tiers = sum(flags.values())
        if tiers >= 2:
            outcome = "QUARANTINED"
        elif flags["data"] or flags["physical"]:
            outcome = "REJECTED"
        elif flags["statistical"]:
            outcome = "HELD"
        else:
            outcome = "DELIVERED"
        if outcome == "DELIVERED":
            self.freshness.accept(pkt["ccsds_header"]["sequence_count"])
        ms = (time.perf_counter() - t0) * 1e3
        return {
            "flags": flags,
            "chi_square": physics["chi_square_breach"],
            "kinematic": physics["kinematic_coupling"]["kinematic_breach"],
            "outcome": outcome,
            "ms": ms,
            "snr_loss_db": float(measured["snr_db"] - link["snr_db"]),
            "verified": crypto["integrity_passed"] and fresh,
        }

    def _attack(self, attack, k, t, measured, sealed, jam_to_noise_db):
        link = dict(measured)
        pkt = sealed
        if attack == "FREQUENCY_HIJACKING":
            # A rogue carrier 14.2 MHz up, sweeping, louder; its frames under its own key.
            link["doppler_shift_hz"] += HIJACK_OFFSET_HZ + HIJACK_SWEEP_HZ * math.sin(0.9 * k)
            link["rssi_dbm"] += HIJACK_EXCESS_DB
            link["snr_db"] += HIJACK_EXCESS_DB
            pkt = self.attacker.seal_packet(_unsealed(sealed))
        elif attack == "STEALTH_SPOOFING":
            # Node 0x99A2 on the Doppler track, 3.2 dB low, reusing recent sequence counts.
            link["doppler_shift_hz"] += float(
                self.rng.uniform(-SPOOF_DOPPLER_ERROR_HZ, SPOOF_DOPPLER_ERROR_HZ)
            )
            link["rssi_dbm"] -= SPOOF_POWER_DROP_DB
            link["snr_db"] -= SPOOF_POWER_DROP_DB
            forged = _unsealed(sealed)
            forged["payload"] = {**forged["payload"], "hw_token": ROGUE_NODE_TOKEN}
            forged["ccsds_header"] = {
                **forged["ccsds_header"],
                "sequence_count": (
                    forged["ccsds_header"]["sequence_count"] - int(self.rng.integers(1, 21))
                )
                % SEQUENCE_MODULO,
            }
            pkt = self.attacker.seal_packet(self.v.framer.rebuild(forged))
        elif attack == "NOISE_JAMMING" or jam_to_noise_db is not None:
            jn = JAM_TO_NOISE_DB if jam_to_noise_db is None else jam_to_noise_db
            loss = snr_loss_db(jn)
            link["snr_db"] -= loss
            if attack == "NOISE_JAMMING":
                # The front end saturates: the carrier estimate collapses, the loop loses lock.
                link["rssi_dbm"] = JAMMED_POWER_DBM + float(self.rng.uniform(-0.5, 0.5))
                link["doppler_shift_hz"] += float(self.rng.normal(0.0, JAM_LOCK_LOSS_HZ))
            else:
                # Below the gate: the carrier power estimate (noise floor + SNR) dips by the loss.
                link["rssi_dbm"] -= loss
        elif attack == "DATA_TAMPERING":
            # One payload bit flipped by a relay after the satellite sealed the frame.
            pkt = copy.deepcopy(sealed)
            mode = pkt["payload"]["mode"]
            pkt["payload"]["mode"] = chr(ord(mode[0]) ^ 1) + mode[1:]
        elif attack == "REPLAY":
            # A genuine frame recorded 1 to 3 minutes earlier, sent again with its recorded RF.
            old = [r for r in self.recorded if REPLAY_AGE_S[0] <= t - r[0] <= REPLAY_AGE_S[1]]
            if old:
                _, pkt, recorded_link = old[int(self.rng.integers(len(old)))]
                link = dict(recorded_link)
            else:
                pkt = self.recorded[0][1]
                link = dict(self.recorded[0][2])
        elif attack == "RELAY":
            # The twin's meaconer: genuine frames forwarded over a 72.5 km longer path, louder.
            link["slant_range_km"] += MEACONING_RANGE_INFLATION_KM
            link["light_time_us"] += MEACONING_RANGE_INFLATION_KM / SPEED_OF_LIGHT_KM_S * 1e6
            link["rssi_dbm"] += MEACONING_GAIN_DB
        elif attack == "DELAY":
            # Genuine frames held back 80 ms and released late: the timing says 24,000 km more.
            link["slant_range_km"] += DELAY_S * SPEED_OF_LIGHT_KM_S
            link["light_time_us"] += DELAY_S * 1e6
        elif attack == "INJECTION":
            # The twin's CCSDS sequence hijack: forged count and telemetry, RF shaped like the
            # satellite, CRC and SHA-256 recomputed, no key.
            forged = _unsealed(sealed)
            forged["ccsds_header"] = {
                **forged["ccsds_header"],
                "sequence_count": (forged["ccsds_header"]["sequence_count"] + HIJACK_SEQUENCE_JUMP)
                % SEQUENCE_MODULO,
            }
            forged["payload"] = {
                **forged["payload"],
                "mode": "SAFE_HOLD",
                "payload_downlink": "DISABLED",
            }
            forged = self.v.framer.rebuild(forged)
            pkt = {
                **forged,
                "sha256_hash": sha256_digest(forged),
                "hmac_sha256": sealed["hmac_sha256"],
            }
        return link, pkt

    # ---------------------------------------------------------------- the uplink

    def uplink(self, threat: str, n: int) -> dict:
        """n telecommands under `threat`; the spacecraft checks the tag, then the count."""
        v = self.v
        onboard = SequenceFreshness()
        executed = rejected = 0
        recorded = []
        for _ in range(n):
            t = self.clock
            self.clock += 1.0
            command = {"opcode": "SET_MODE", "mode": "IMAGING"}
            genuine = v.crypto.seal_packet(
                v.framer.build_telecommand_packet(v.uplink_sequence % SEQUENCE_MODULO, command, t)
            )
            v.uplink_sequence += 1
            # The genuine command goes through first, as on a real pass.
            if v.crypto.verify_packet_integrity(genuine)["integrity_passed"]:
                onboard.accept(genuine["ccsds_header"]["sequence_count"])
            recorded.append(genuine)
            if threat == "COMMAND_TAMPERING":
                received = v.injector.inject_uplink_threat(genuine, "COMMAND_TAMPERING")
            elif threat == "COMMAND_INJECTION":
                received = v.injector.inject_uplink_threat(genuine, "COMMAND_INJECTION")
            else:
                received = recorded[int(self.rng.integers(len(recorded)))]
            ok = v.crypto.verify_packet_integrity(received)["integrity_passed"]
            count = received["ccsds_header"]["sequence_count"]
            if ok and onboard.fresh(count):
                onboard.accept(count)
                executed += 1
            else:
                rejected += 1
        return {"commands": n, "executed": executed, "rejected": rejected}


def _unsealed(sealed: dict) -> dict:
    return {
        k: v for k, v in copy.deepcopy(sealed).items() if k not in ("sha256_hash", "hmac_sha256")
    }


def _empty() -> dict:
    return {
        "n": 0,
        "data": 0,
        "statistical": 0,
        "physical": 0,
        "chi_square": 0,
        "kinematic": 0,
        "verified": 0,
        "snr_loss_db": 0.0,
        **{o: 0 for o in OUTCOMES},
    }


def _count(c: dict, r: dict) -> None:
    c["n"] += 1
    for tier, flagged in r["flags"].items():
        c[tier] += flagged
    c["chi_square"] += r["chi_square"]
    c["kinematic"] += r["kinematic"]
    c["verified"] += r["verified"]
    c["snr_loss_db"] += r["snr_loss_db"]
    c[r["outcome"]] += 1


def run_seed(
    seed: int,
    n_train: int = 3000,
    n_nominal: int = 6000,
    bursts: int = 50,
    burst_len: int = 30,
    uplink_commands: int = 50,
) -> dict:
    run = Run(seed, n_train)
    counts = {m: _empty() for m in ("NONE", *ATTACKS, *EVASION)}
    first_stop: dict[str, list[int]] = {m: [] for m in ATTACKS}
    times: list[float] = []

    per_gap = n_nominal // (bursts * len(ATTACKS))
    for _ in range(bursts):
        for attack in ATTACKS:
            for _ in range(per_gap):
                r = run.packet("NONE", 0)
                _count(counts["NONE"], r)
                times.append(r["ms"])
            stopped_at = None
            for k in range(burst_len):
                r = run.packet(attack, k)
                _count(counts[attack], r)
                times.append(r["ms"])
                if stopped_at is None and r["outcome"] != "DELIVERED":
                    stopped_at = k + 1
            first_stop[attack].append(stopped_at or burst_len + 1)

    for name, jn in EVASION.items():
        for _ in range(bursts):
            for _ in range(per_gap):
                _count(counts["NONE"], run.packet("NONE", 0))
            for k in range(burst_len):
                _count(counts[name], run.packet(name, k, jam_to_noise_db=jn))

    uplink = {threat: run.uplink(threat, uplink_commands) for threat in UPLINK}
    rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    return {
        "seed": seed,
        "counts": counts,
        "packets_to_first_stop": {m: statistics.mean(v) for m, v in first_stop.items()},
        "packet_ms": {
            "mean": statistics.mean(times),
            "p95": statistics.quantiles(times, n=20)[18],
        },
        "uplink": uplink,
        "python_rss_mb": rss_mb,
    }


def _pct(v: float) -> str:
    return f"{100 * v:.1f}%"


def print_summary(results: list[dict]) -> None:
    def span(values):
        lo, hi = min(values), max(values)
        return _pct(lo) if abs(hi - lo) < 5e-4 else f"{_pct(lo)}–{_pct(hi)}"

    print(f"seeds {[r['seed'] for r in results]}")
    head = f"{'traffic':24}{'pkts/seed':>10}{'data':>14}{'stat':>14}{'phys':>14}"
    print(head + "".join(f"{o.lower():>16}" for o in OUTCOMES))
    for name in ("NONE", *ATTACKS, *EVASION):
        rows = [r["counts"][name] for r in results]
        n = rows[0]["n"]
        line = f"{name:24}{n:>10}"
        for key in ("data", "statistical", "physical"):
            line += f"{span([c[key] / c['n'] for c in rows]):>14}"
        for key in OUTCOMES:
            line += f"{span([c[key] / c['n'] for c in rows]):>16}"
        print(line)
    clean = [r["counts"]["NONE"] for r in results]
    total = sum(c["n"] for c in clean)
    chi = sum(c["chi_square"] for c in clean)
    print(f"chi-square false alarms on clean packets: {chi}/{total} = {chi / total:.2e}")
    for name in EVASION:
        rows = [r["counts"][name] for r in results]
        loss = sum(c["snr_loss_db"] for c in rows) / sum(c["n"] for c in rows)
        verified = sum(c["verified"] for c in rows) / sum(c["n"] for c in rows)
        print(f"{name}: mean SNR loss {loss:.2f} dB, frames verified {_pct(verified)}")
    print("packets to first stop:")
    for name in ATTACKS:
        print(
            f"  {name:22}{statistics.mean(r['packets_to_first_stop'][name] for r in results):.2f}"
        )
    ms = [r["packet_ms"]["mean"] for r in results]
    p95 = [r["packet_ms"]["p95"] for r in results]
    print(f"per-packet time: mean {min(ms):.1f}–{max(ms):.1f} ms, p95 ≤ {max(p95):.1f} ms")
    for threat in UPLINK:
        executed = sum(r["uplink"][threat]["executed"] for r in results)
        commands = sum(r["uplink"][threat]["commands"] for r in results)
        print(f"uplink {threat:20} {executed}/{commands} executed")
    print(f"Python peak RSS: {max(r['python_rss_mb'] for r in results):.0f} MB")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[3])
    parser.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3, 4, 5, 6])
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--json", help="write every seed's counts to this file")
    args = parser.parse_args()
    if args.workers > 1:
        with ProcessPoolExecutor(args.workers) as pool:
            results = list(pool.map(run_seed, args.seeds))
    else:
        results = [run_seed(seed) for seed in args.seeds]
    if args.json:
        with open(args.json, "w") as out:
            json.dump(results, out, indent=1)
    print_summary(results)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
