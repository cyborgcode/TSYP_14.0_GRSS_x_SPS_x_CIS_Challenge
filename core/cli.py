"""End-to-end scenario runner for the ground-link testbed.

Generates a clean record, seals it with the trust anchor, injects one attack, then fits and
scores the detector — the standard scenario in a single reproducible command.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import replace
from typing import Any

import numpy as np

from .attacks import ATTACKS, Window
from .detectors import GroundLinkDetector
from .evaluate import score_run
from .features import extract
from .observables import LinkConfig, Observables, generate
from .trust import ObservationLog


def seal(obs: Observables, key: bytes) -> ObservationLog:
    """Commit every epoch of a record to the trust anchor."""
    log = ObservationLog(key)
    for epoch in range(obs.epochs):
        log.append(
            timestamp=epoch * obs.epoch_seconds,
            payload={
                "cn0_db": [round(float(v), 4) for v in obs.cn0_db[epoch]],
                "agc_db": round(float(obs.agc_db[epoch]), 4),
                "clock_bias_ns": round(float(obs.clock_bias_ns[epoch]), 4),
                "residual_m": [round(float(v), 4) for v in obs.pseudorange_residual_m[epoch]],
            },
        )
    return log


def run(
    attack: str,
    onset: int,
    duration: int,
    target_pfa: float,
    train_epochs: int,
    seed: int,
) -> dict[str, Any]:
    if attack not in ATTACKS:
        raise SystemExit(f"unknown attack {attack!r}; choose from {sorted(ATTACKS)}")

    config = LinkConfig(seed=seed)
    if onset + duration > config.epochs:
        raise SystemExit(f"attack window exceeds the {config.epochs}-epoch record")
    if train_epochs >= onset:
        raise SystemExit("training window must end before the attack onset")

    clean = generate(config)
    attacked = ATTACKS[attack](clean, Window(onset, onset + duration))

    detector = GroundLinkDetector(target_pfa=target_pfa).fit(extract(clean)[:train_epochs])
    features = extract(attacked)
    scores = detector.score(features)
    alarms = detector.alarms(features)
    metrics = score_run(scores, alarms, attacked.labels)

    log = seal(attacked, key=b"testbed-development-key")
    chain_ok, chain_reason = log.verify()

    # An attacker who edits the sealed record after the fact must break the chain.
    forged = list(log.records)
    forged[onset] = replace(forged[onset], payload_digest="0" * 64)
    forged_ok, forged_reason = log.verify(forged)

    first_alarm = int(np.flatnonzero(alarms)[0]) if alarms.any() else -1

    return {
        "attack": attack,
        "window": {"onset": onset, "duration": duration},
        "operating_point": {
            "target_pfa": target_pfa,
            "threshold": round(detector.threshold, 4),
            "cusum_drift": round(detector.cusum_drift, 4),
        },
        "metrics": metrics.as_row(),
        "dominant_feature": detector.attribute(features, onset + duration // 2),
        "first_alarm_epoch": first_alarm,
        "trust_anchor": {
            "epochs_sealed": len(log),
            "chain_valid": chain_ok,
            "chain_reason": chain_reason,
            "tamper_detected": not forged_ok,
            "tamper_reason": forged_reason,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attack", default="spoofing", choices=sorted(ATTACKS))
    parser.add_argument("--onset", type=int, default=300, help="attack start epoch")
    parser.add_argument("--duration", type=int, default=120, help="attack length in epochs")
    parser.add_argument("--pfa", type=float, default=0.01, help="target false-alarm rate")
    parser.add_argument("--train-epochs", type=int, default=250)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--json", help="write the result to this path")
    args = parser.parse_args(argv)

    result = run(
        attack=args.attack,
        onset=args.onset,
        duration=args.duration,
        target_pfa=args.pfa,
        train_epochs=args.train_epochs,
        seed=args.seed,
    )

    print(json.dumps(result, indent=2))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
