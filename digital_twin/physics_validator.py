"""
physics_validator.py
TSYP 14 Track 1: Secure Ground-Link Testbed
Digital twin, phase 3: the master orchestrator, the ground link end to end, one tick at a time.

1. Truth: SGP4 state, station geometry and link budget at this instant.
2. The satellite frames its telemetry as a CCSDS packet and seals it (SHA-256, HMAC-SHA256).
3. The receiver measures the link with its natural noise; a threat vector, if any, acts here.
4. Three independent layers judge what arrived: crypto, Isolation Forest, chi-square physics.
5. Either deterministic layer (crypto or physics) rejects the packet; the statistical layer
   alone holds it for review; otherwise it is accepted. Each tick can go to the audit log.

The red-team label travels with each result for scoring only; no layer ever reads it.

Run `python -m digital_twin.physics_validator` for a pass-by-pass red-team report.
"""

from __future__ import annotations

import logging
import math
import time
from datetime import UTC, datetime

import numpy as np

from testbed.ingester import SAT_ID, SAT_TOKEN

from .attack_injector import ATTACK_VECTORS, AerospaceAttackInjector
from .audit_logger import AuditLogger
from .ccsds_framing import CCSDSFrameHandler
from .crypto_hash_verifier import CryptoIntegrityVerifier, sha256_digest
from .ephemeris_loader import EphemerisLoader
from .isolation_forest_detector import MLAnomalyDetector
from .link_budget import LinkBudgetCalculator
from .propagation import OrbitPropagator
from .security_detector import NATURAL_SIGMA, PhysicsSecurityEngine, elevation_spread_factor
from .visibility_calculator import VisibilityCalculator

logger = logging.getLogger("MasterOrchestrator")

NOISE_FLOOR_SIGMA_DB = 0.1


class MasterTelemetryValidator:
    """Coordinates the end-to-end simulation loop across all three security layers."""

    def __init__(
        self,
        seed: int = 14,
        tle: dict | None = None,
        audit_logger: AuditLogger | None = None,
        crypto: CryptoIntegrityVerifier | None = None,
        training_passes: int = 8,
    ):
        self.loader = EphemerisLoader()
        self.tle = tle or self.loader.fetch_latest_tle()
        self.propagator = OrbitPropagator(self.tle)
        self.link_calc = LinkBudgetCalculator()
        self.vis_calc = VisibilityCalculator()
        self.framer = CCSDSFrameHandler()
        self.injector = AerospaceAttackInjector(self.framer, digest=sha256_digest)
        self.crypto = crypto or CryptoIntegrityVerifier()
        self.ml_detector = MLAnomalyDetector()
        self.physics_engine = PhysicsSecurityEngine()
        self.audit = audit_logger
        self.rng = np.random.default_rng(seed)
        self.sequence = 0
        self._train_statistical_layer(training_passes)

    # ------------------------------------------------------------------ physics

    def true_link(self, timestamp: float) -> tuple[dict, dict]:
        """Satellite look angles and the link the orbit predicts at `timestamp`."""
        eci = self.propagator.propagate_eci_state(timestamp)
        vis = self.vis_calc.calculate_topocentric_angles(eci["position_eci_km"], timestamp)
        gs_pos, gs_vel = self.vis_calc.station_state_eci(timestamp)
        link = self.link_calc.compute_rf_link(
            eci["position_eci_km"], eci["velocity_eci_km_s"], gs_pos, gs_vel, vis["elevation_deg"]
        )
        return vis, link

    def measure(self, true_link: dict, elevation_deg: float) -> dict:
        """What the receiver measures: the truth plus natural noise, wider near the horizon."""
        spread = math.sqrt(elevation_spread_factor(elevation_deg))
        measured = dict(true_link)
        for name, sigma in NATURAL_SIGMA.items():
            measured[name] = true_link[name] + float(self.rng.normal(0.0, sigma * spread))
        # SNR comes from the receiver's own noise-floor estimate, itself a little noisy.
        noise_floor = self.link_calc.noise_floor_dbm + float(
            self.rng.normal(0.0, NOISE_FLOOR_SIGMA_DB)
        )
        measured["snr_db"] = measured["rssi_dbm"] - noise_floor
        measured["light_time_us"] = measured["slant_range_km"] / 0.299792458
        return measured

    def next_pass(self, start: float | None = None) -> dict:
        start = time.time() if start is None else start
        found = self.vis_calc.find_next_pass(self.propagator, start)
        if found is None:
            raise RuntimeError("no pass over the station in the next 36 hours")
        return found

    def _train_statistical_layer(self, passes: int) -> None:
        samples, start = [], self.tle["epoch_unix"]
        for _ in range(passes):
            found = self.next_pass(start)
            for t in np.arange(found["aos_unix"], found["los_unix"], 10.0):
                vis, link = self.true_link(float(t))
                samples.append(self.measure(link, vis["elevation_deg"]))
            start = found["los_unix"] + 60.0
        self.ml_detector.fit(samples)

    # ------------------------------------------------------------------ one tick

    def telemetry_payload(self, timestamp: float) -> dict:
        return {
            "satellite_id": SAT_ID,
            "hw_token": SAT_TOKEN,
            "utc": datetime.fromtimestamp(timestamp, UTC).isoformat(timespec="milliseconds"),
            "mode": "IMAGING",
            "payload_downlink": "ENABLED",
            "battery_v": round(28.0 + float(self.rng.normal(0.0, 0.05)), 3),
            "panel_temp_c": round(21.0 + float(self.rng.normal(0.0, 0.4)), 2),
        }

    def run_simulation_tick(self, timestamp: float, attack_vector: str = "NONE") -> dict:
        if attack_vector not in ATTACK_VECTORS:
            raise ValueError(f"unknown attack vector {attack_vector!r}; expected {ATTACK_VECTORS}")
        # Step 1: true space physics.
        vis, true_link = self.true_link(timestamp)
        result = {
            "timestamp": timestamp,
            "utc": datetime.fromtimestamp(timestamp, UTC).isoformat(timespec="seconds"),
            "elevation_deg": vis["elevation_deg"],
            "azimuth_deg": vis["azimuth_deg"],
            "red_team_vector": attack_vector,
        }
        if not vis["is_above_horizon"]:
            result.update(link_available=False, final_decision="NO_LINK", reasons=["below mask"])
            if self.audit:
                self.audit.log_telemetry_event(result)
            return result

        # Step 2: the satellite frames and seals its telemetry.
        packet = self.framer.build_telemetry_packet(
            self.sequence, self.telemetry_payload(timestamp), timestamp
        )
        sealed = self.crypto.seal_packet(packet)
        self.sequence += 1

        # Step 3: the receiver measures the link; the threat vector acts on what arrives.
        measured = self.measure(true_link, vis["elevation_deg"])
        rx_link, rx_packet = self.injector.inject_threat(measured, sealed, attack_vector)

        # Step 4: three independent layers.
        crypto = self.crypto.verify_packet_integrity(rx_packet)
        ml = self.ml_detector.evaluate_packet(rx_link)
        physics = self.physics_engine.evaluate_telemetry_physics(
            rx_link, true_link, vis["elevation_deg"]
        )

        # Step 5: decision.
        reasons = []
        if not crypto["integrity_passed"]:
            reasons.append("crypto: " + crypto["verdict"])
        if physics["physical_breach_detected"]:
            reasons.append("physics: " + physics["verdict"])
        if reasons:
            decision = "REJECTED"
        elif ml["threat_detected"]:
            decision, reasons = "HELD", ["ml: " + ml["verdict"]]
        else:
            decision = "ACCEPTED"

        result.update(
            link_available=True,
            sequence_count=rx_packet["ccsds_header"]["sequence_count"],
            claimed_range_km=rx_link["slant_range_km"],
            expected_range_km=true_link["slant_range_km"],
            claimed_doppler_hz=rx_link["doppler_shift_hz"],
            expected_doppler_hz=true_link["doppler_shift_hz"],
            claimed_rssi_dbm=rx_link["rssi_dbm"],
            expected_rssi_dbm=true_link["rssi_dbm"],
            claimed_phase_error_deg=rx_link["received_phase_error_deg"],
            expected_phase_error_deg=true_link["received_phase_error_deg"],
            snr_db=rx_link["snr_db"],
            crypto_result=crypto,
            ml_result=ml,
            security_result=physics,
            final_decision=decision,
            reasons=reasons,
        )
        if self.audit:
            self.audit.log_telemetry_event(result)
        return result

    # ------------------------------------------------------------------ a whole pass

    def run_pass(
        self,
        attack_vector: str = "NONE",
        start: float | None = None,
        step_s: float = 10.0,
        attack_window: tuple[float, float] = (0.3, 0.7),
    ) -> dict:
        """Ticks across the next pass; the threat acts during `attack_window` (pass fractions)."""
        found = self.next_pass(start)
        ticks = []
        for t in np.arange(found["aos_unix"], found["los_unix"], step_s):
            fraction = (t - found["aos_unix"]) / found["duration_s"]
            active = attack_window[0] <= fraction <= attack_window[1]
            ticks.append(self.run_simulation_tick(float(t), attack_vector if active else "NONE"))
        return {"pass": found, "attack_vector": attack_vector, "ticks": ticks, **summarise(ticks)}


def summarise(ticks: list[dict]) -> dict:
    """Decisions and per-layer detections, split by red-team ground truth."""
    linked = [t for t in ticks if t["link_available"]]
    attacked = [t for t in linked if t["red_team_vector"] != "NONE"]
    clean = [t for t in linked if t["red_team_vector"] == "NONE"]

    def share(rows, test):
        return sum(test(r) for r in rows) / len(rows) if rows else 0.0

    return {
        "ticks_with_link": len(linked),
        "attack_ticks": len(attacked),
        "attack_rejected": share(attacked, lambda r: r["final_decision"] == "REJECTED"),
        "attack_stopped": share(attacked, lambda r: r["final_decision"] != "ACCEPTED"),
        "crypto_flagged": share(attacked, lambda r: not r["crypto_result"]["integrity_passed"]),
        "physics_flagged": share(
            attacked, lambda r: r["security_result"]["physical_breach_detected"]
        ),
        "ml_flagged": share(attacked, lambda r: r["ml_result"]["threat_detected"]),
        "clean_ticks": len(clean),
        "clean_rejected": share(clean, lambda r: r["final_decision"] == "REJECTED"),
        "clean_held": share(clean, lambda r: r["final_decision"] == "HELD"),
    }


def main() -> None:
    validator = MasterTelemetryValidator()
    start = validator.tle["epoch_unix"]
    tle = validator.tle
    print(f"Digital twin: {tle['sat_name']} over Zaghouan, TLE epoch {tle['epoch_utc']}")
    columns = "stopped  crypto  physics  ml  clean held"
    print(f"{'threat vector':26} {'pass (UTC)':17} {'max el':>6}  {columns}")
    for vector in ATTACK_VECTORS:
        report = validator.run_pass(vector, start=start)
        found = report["pass"]
        aos = datetime.fromtimestamp(found["aos_unix"], UTC).strftime("%m-%d %H:%M")
        print(
            f"{vector:26} {aos:17} {found['max_elevation_deg']:5.1f}°"
            f"  {report['attack_stopped']:7.0%}  {report['crypto_flagged']:6.0%}"
            f"  {report['physics_flagged']:7.0%}  {report['ml_flagged']:3.0%}"
            f"  {report['clean_held']:10.0%}"
        )
        start = found["los_unix"] + 60.0


if __name__ == "__main__":
    main()
