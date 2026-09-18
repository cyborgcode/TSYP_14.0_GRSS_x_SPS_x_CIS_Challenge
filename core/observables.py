"""Nominal GNSS ground-link observables.

Models what a receiver reports per epoch rather than raw baseband samples: carrier-to-noise
density per channel, front-end AGC gain, pseudorange residuals and receiver clock bias.
These are the observables an operator can log and sign, so they are the layer the testbed
defends.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np


@dataclass(frozen=True)
class LinkConfig:
    """Parameters of the nominal (un-attacked) link."""

    n_channels: int = 8
    epochs: int = 600
    epoch_seconds: float = 1.0
    nominal_cn0_db: float = 45.0
    cn0_spread_db: float = 4.0
    cn0_jitter_db: float = 0.8
    nominal_agc_db: float = 30.0
    agc_jitter_db: float = 0.3
    clock_drift_ns_per_s: float = 5.0
    clock_jitter_ns: float = 2.0
    pseudorange_noise_m: float = 1.5
    seed: int = 0


@dataclass
class Observables:
    """Per-epoch receiver observables plus ground-truth attack labels."""

    cn0_db: np.ndarray  # (epochs, n_channels)
    agc_db: np.ndarray  # (epochs,)
    pseudorange_residual_m: np.ndarray  # (epochs, n_channels)
    clock_bias_ns: np.ndarray  # (epochs,)
    labels: np.ndarray  # (epochs,) 1 where an attack is active
    epoch_seconds: float

    @property
    def epochs(self) -> int:
        return int(self.cn0_db.shape[0])

    @property
    def n_channels(self) -> int:
        return int(self.cn0_db.shape[1])

    def copy(self) -> Observables:
        return replace(
            self,
            cn0_db=self.cn0_db.copy(),
            agc_db=self.agc_db.copy(),
            pseudorange_residual_m=self.pseudorange_residual_m.copy(),
            clock_bias_ns=self.clock_bias_ns.copy(),
            labels=self.labels.copy(),
        )


def generate(config: LinkConfig | None = None) -> Observables:
    """Generate a clean observable record for the configured link."""
    config = config or LinkConfig()
    rng = np.random.default_rng(config.seed)

    # Each channel sits at its own mean C/N0 — real constellations are never uniform.
    channel_means = config.nominal_cn0_db + rng.normal(
        0.0, config.cn0_spread_db, size=config.n_channels
    )
    cn0 = channel_means + rng.normal(
        0.0, config.cn0_jitter_db, size=(config.epochs, config.n_channels)
    )

    agc = config.nominal_agc_db + rng.normal(0.0, config.agc_jitter_db, size=config.epochs)

    residual = rng.normal(0.0, config.pseudorange_noise_m, size=(config.epochs, config.n_channels))

    t = np.arange(config.epochs) * config.epoch_seconds
    clock_bias = config.clock_drift_ns_per_s * t + rng.normal(
        0.0, config.clock_jitter_ns, size=config.epochs
    )

    return Observables(
        cn0_db=cn0,
        agc_db=agc,
        pseudorange_residual_m=residual,
        clock_bias_ns=clock_bias,
        labels=np.zeros(config.epochs, dtype=int),
        epoch_seconds=config.epoch_seconds,
    )
