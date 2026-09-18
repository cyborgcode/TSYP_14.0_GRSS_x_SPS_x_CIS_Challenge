"""Controlled adversarial injection against the ground link.

Each attack mutates a copy of the clean observables and marks the affected epochs, so an
attack is always paired with the ground truth needed to score a detector.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .observables import Observables


@dataclass(frozen=True)
class Window:
    """Epoch range an attack is active over, end-exclusive."""

    start: int
    end: int

    def slice(self) -> slice:
        return slice(self.start, self.end)

    def __post_init__(self) -> None:
        if self.start < 0 or self.end <= self.start:
            raise ValueError(f"invalid attack window: start={self.start} end={self.end}")


def broadband_jamming(
    obs: Observables,
    window: Window,
    jam_power_db: float = 12.0,
    ramp_epochs: int = 10,
) -> Observables:
    """Raise the noise floor across every channel.

    Signature: C/N0 falls on all channels at once and the front-end AGC backs off to avoid
    saturating. Loud and non-stealthy, but it is the baseline denial case.
    """
    out = obs.copy()
    sel = window.slice()
    n = out.cn0_db[sel].shape[0]
    ramp = np.minimum(np.arange(1, n + 1) / max(ramp_epochs, 1), 1.0)

    out.cn0_db[sel] -= (jam_power_db * ramp)[:, None]
    out.agc_db[sel] -= jam_power_db * 0.6 * ramp
    out.labels[sel] = 1
    return out


def spoofing(
    obs: Observables,
    window: Window,
    cn0_lift_db: float = 3.0,
    cn0_uniformity: float = 0.15,
    clock_step_ns: float = 120.0,
    takeover_epochs: int = 15,
) -> Observables:
    """Replace the constellation with a counterfeit one.

    Signature: a single transmitter drives every channel, so the natural inter-channel C/N0
    spread collapses toward uniform while the mean rises slightly, and the receiver clock
    solution takes a step as the counterfeit takes over. AGC stays nominal — which is exactly
    why an AGC-only monitor misses this.
    """
    out = obs.copy()
    sel = window.slice()
    n = out.cn0_db[sel].shape[0]

    block = out.cn0_db[sel]
    per_epoch_mean = block.mean(axis=1, keepdims=True)
    # Pull each channel toward the common mean: the spread collapse is the tell.
    out.cn0_db[sel] = per_epoch_mean + (block - per_epoch_mean) * cn0_uniformity + cn0_lift_db

    ramp = np.minimum(np.arange(1, n + 1) / max(takeover_epochs, 1), 1.0)
    out.clock_bias_ns[sel] += clock_step_ns * ramp
    out.labels[sel] = 1
    return out


def meaconing(
    obs: Observables,
    window: Window,
    delay_m: float = 45.0,
    cn0_lift_db: float = 2.0,
) -> Observables:
    """Rebroadcast the authentic signal on a delay.

    Signature: the delay is common-mode, so every pseudorange residual shifts by the same
    bias while the inter-channel structure is preserved. Per-channel outlier tests miss it;
    a common-mode test catches it.
    """
    out = obs.copy()
    sel = window.slice()

    out.pseudorange_residual_m[sel] += delay_m
    out.cn0_db[sel] += cn0_lift_db
    out.labels[sel] = 1
    return out


ATTACKS = {
    "jamming": broadband_jamming,
    "spoofing": spoofing,
    "meaconing": meaconing,
}
