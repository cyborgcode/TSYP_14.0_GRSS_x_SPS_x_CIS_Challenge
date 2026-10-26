"""
link_budget.py
TSYP 14 Track 1: Secure Ground-Link Testbed
Digital twin, phase 1: the X-band downlink budget.

From the satellite and station states it gives what the receiver should see: slant range,
range rate, Doppler shift, light time, path loss, SNR and RSSI. The budget is the live
dashboard's (EIRP 18 dBW, G/T 31 dB/K, 300 MHz channel, 2 dB fixed losses, -100 dBm noise
floor). On top of free-space loss, clear-sky gaseous absorption (ITU-R P.676 zenith value
at X-band, about 0.05 dB) is scaled by the air mass of the slant path, which grows near the
horizon.
"""

from __future__ import annotations

import logging
import math

import numpy as np

from testbed.ingester import NOMINAL_CARRIER_MHZ

logger = logging.getLogger("LinkBudgetCalculator")

SPEED_OF_LIGHT_M_S = 299_792_458.0
BOLTZMANN_DBW_PER_HZ_K = -228.6


def air_mass(elevation_deg: float) -> float:
    """Relative atmospheric path length (Kasten and Young), finite down to the horizon."""
    el = max(float(elevation_deg), 0.0)
    return 1.0 / (math.sin(math.radians(el)) + 0.50572 * (el + 6.07995) ** -1.6364)


class LinkBudgetCalculator:
    def __init__(
        self,
        carrier_freq_hz: float = NOMINAL_CARRIER_MHZ * 1e6,
        eirp_dbw: float = 18.0,
        g_over_t_db_k: float = 31.0,
        bandwidth_hz: float = 300e6,
        fixed_losses_db: float = 2.0,
        noise_floor_dbm: float = -100.0,
        zenith_gas_attenuation_db: float = 0.05,
    ):
        self.freq_hz = carrier_freq_hz
        self.eirp_dbw = eirp_dbw
        self.g_over_t_db_k = g_over_t_db_k
        self.bandwidth_hz = bandwidth_hz
        self.fixed_losses_db = fixed_losses_db
        self.noise_floor_dbm = noise_floor_dbm
        self.zenith_gas_attenuation_db = zenith_gas_attenuation_db
        self.c = SPEED_OF_LIGHT_M_S

    def free_space_loss_db(self, slant_range_km: float) -> float:
        return 20.0 * math.log10(4.0 * math.pi * slant_range_km * 1000.0 * self.freq_hz / self.c)

    def atmospheric_loss_db(self, elevation_deg: float) -> float:
        return self.zenith_gas_attenuation_db * air_mass(elevation_deg)

    def compute_rf_link(
        self,
        sat_pos: list,
        sat_vel: list,
        gs_pos: list,
        gs_vel: list | None = None,
        elevation_deg: float = 90.0,
    ) -> dict:
        """Slant range, Doppler, path loss, SNR and RSSI for one satellite-station geometry.

        Positions in km and velocities in km/s, both in the same inertial frame.
        """
        r_vec = np.asarray(sat_pos, dtype=float) - np.asarray(gs_pos, dtype=float)
        v_rel = np.asarray(sat_vel, dtype=float) - np.asarray(
            gs_vel if gs_vel is not None else (0.0, 0.0, 0.0), dtype=float
        )
        slant_range_km = float(np.linalg.norm(r_vec))
        range_rate_km_s = float(np.dot(v_rel, r_vec / slant_range_km))
        # Doppler shift f_d = -f_c * (v . r_hat) / c: an approaching satellite shifts it up.
        doppler_shift_hz = -self.freq_hz * range_rate_km_s * 1000.0 / self.c

        fspl_db = self.free_space_loss_db(slant_range_km)
        atmospheric_db = self.atmospheric_loss_db(elevation_deg)
        path_loss_db = fspl_db + atmospheric_db + self.fixed_losses_db
        cn0_dbhz = self.eirp_dbw - path_loss_db + self.g_over_t_db_k - BOLTZMANN_DBW_PER_HZ_K
        snr_db = cn0_dbhz - 10.0 * math.log10(self.bandwidth_hz)

        return {
            "carrier_hz": self.freq_hz,
            "slant_range_km": slant_range_km,
            "range_rate_km_s": range_rate_km_s,
            "light_time_us": slant_range_km * 1000.0 / self.c * 1e6,
            "doppler_shift_hz": doppler_shift_hz,
            "fspl_db": fspl_db,
            "atmospheric_loss_db": atmospheric_db,
            "path_loss_db": path_loss_db,
            "cn0_dbhz": cn0_dbhz,
            "snr_db": snr_db,
            "rssi_dbm": self.noise_floor_dbm + snr_db,
            # A receiver locked on the genuine carrier tracks it with no phase error.
            "received_phase_error_deg": 0.0,
        }
