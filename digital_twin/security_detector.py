"""
security_detector.py
TSYP 14 Track 1: Secure Ground-Link Testbed
Digital twin, phase 2: the physical layer. A chi-square test of what the signal claims
against what orbital mechanics says it must be.

The station predicts range, Doppler, received power and carrier phase from the orbit. Each
measured residual is divided by its natural one-sigma spread on a clean pass, the figures
the dashboard measured: 1.6 us of frame timing (0.48 km of range), 6.1 Hz of carrier, 0.23
dB of power, plus 1.5 deg of carrier phase. The squares are summed: on a clean link the sum
follows a chi-square law with four degrees of freedom, so the gate is the quantile for a
1e-4 false-alarm rate. Near the horizon tropospheric scintillation and multipath widen the
residuals, and the gate widens with them. A replayed, delayed or re-transmitted signal
cannot match the geometry, so it fails the test however clean its cryptography.
"""

from __future__ import annotations

import logging
import math

logger = logging.getLogger("PhysicsSecurityEngine")

SPEED_OF_LIGHT_KM_S = 299_792.458

#: Natural one-sigma spread of each residual on a clean pass, above ~30 deg elevation.
NATURAL_SIGMA = {
    "slant_range_km": 1.6e-6 * SPEED_OF_LIGHT_KM_S,
    "doppler_shift_hz": 6.1,
    "rssi_dbm": 0.23,
    "received_phase_error_deg": 1.5,
}


def chi_square_sf(x: float, dof: int) -> float:
    """Survival function of the chi-square law, exact for an even number of degrees of freedom."""
    if dof % 2:
        raise ValueError("closed form needs an even number of degrees of freedom")
    half = x / 2.0
    term, total = 1.0, 1.0
    for i in range(1, dof // 2):
        term *= half / i
        total += term
    return math.exp(-half) * total


def chi_square_quantile(probability: float, dof: int) -> float:
    """Inverse CDF of the chi-square law, by bisection on the survival function."""
    low, high = 0.0, 1000.0
    for _ in range(200):
        mid = 0.5 * (low + high)
        if 1.0 - chi_square_sf(mid, dof) < probability:
            low = mid
        else:
            high = mid
    return 0.5 * (low + high)


def elevation_spread_factor(elevation_deg: float) -> float:
    """Variance growth of the residuals near the horizon: 3x at 0 deg, ~1 above 30 deg."""
    return 1.0 + 2.0 * math.exp(-max(float(elevation_deg), 0.0) / 6.0)


class PhysicsSecurityEngine:
    def __init__(self, false_alarm_rate: float = 1e-4, sigmas: dict | None = None):
        self.sigmas = dict(sigmas or NATURAL_SIGMA)
        self.false_alarm_rate = false_alarm_rate
        self.dof = len(self.sigmas)
        self.base_threshold = chi_square_quantile(1.0 - false_alarm_rate, self.dof)

    def adaptive_threshold(self, elevation_deg: float) -> float:
        return self.base_threshold * elevation_spread_factor(elevation_deg)

    def evaluate_telemetry_physics(
        self, rx_link: dict, true_link: dict, elevation_deg: float
    ) -> dict:
        """Chi-square of the received link against the orbit prediction, and the verdict."""
        residuals = {name: rx_link[name] - true_link[name] for name in self.sigmas}
        normalized = {name: residuals[name] / sigma for name, sigma in self.sigmas.items()}
        chi_square = sum(z * z for z in normalized.values())
        threshold = self.adaptive_threshold(elevation_deg)
        breach = chi_square > threshold
        return {
            "layer": "Physical Layer (Chi-Square)",
            "chi_square_value": chi_square,
            "adaptive_threshold": threshold,
            "degrees_of_freedom": self.dof,
            "false_alarm_rate": self.false_alarm_rate,
            "residuals": residuals,
            "normalized_residuals": normalized,
            "dominant_residual": max(normalized, key=lambda name: abs(normalized[name])),
            "physical_breach_detected": breach,
            "verdict": "PHYSICS_VIOLATION" if breach else "PHYSICS_CONSISTENT",
        }
