"""Per-epoch features derived from receiver observables.

Each feature targets a specific attack signature, so a detector built on them stays
interpretable — a requirement for the threat-model deliverable.
"""

from __future__ import annotations

import numpy as np

from .observables import Observables

FEATURE_NAMES = (
    "cn0_mean",
    "cn0_spread",
    "agc",
    "clock_innovation",
    "residual_common_mode",
    "residual_dispersion",
)


def extract(obs: Observables) -> np.ndarray:
    """Return an (epochs, len(FEATURE_NAMES)) feature matrix."""
    cn0_mean = obs.cn0_db.mean(axis=1)
    cn0_spread = obs.cn0_db.std(axis=1)

    # Second difference removes the nominal linear clock drift, leaving the step an attack
    # introduces when it takes over the solution.
    clock = obs.clock_bias_ns
    innovation = np.zeros_like(clock)
    innovation[2:] = clock[2:] - 2.0 * clock[1:-1] + clock[:-2]

    residual_common_mode = obs.pseudorange_residual_m.mean(axis=1)
    residual_dispersion = obs.pseudorange_residual_m.std(axis=1)

    return np.column_stack(
        [
            cn0_mean,
            cn0_spread,
            obs.agc_db,
            np.abs(innovation),
            np.abs(residual_common_mode),
            residual_dispersion,
        ]
    )
