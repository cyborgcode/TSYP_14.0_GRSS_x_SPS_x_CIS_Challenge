"""
isolation_forest_detector.py
TSYP 14 Track 1: Secure Ground-Link Testbed
Digital twin, phase 2: the statistical layer. An Isolation Forest scores each link
measurement against the clean passes it was trained on.

Unsupervised: it only ever sees nominal traffic and needs neither attack labels nor the
orbit model, which keeps it independent of the physics layer. From the five link
measurements it derives three relations that hold on any clean pass:
- the size of the carrier phase tracking error, near zero while the loop is locked on
  the genuine carrier;
- the received power normalised by range, RSSI + 20 log10(range), constant under the
  free-space law up to atmospheric loss and noise;
- the noise floor implied by RSSI and SNR, which only the receiver itself sets.
A meaconer's louder, longer path breaks the second and third; a phase slip, the first.
Doppler is left to the physics layer, since judging it needs the orbit. Features are
standardised so that no unit dominates the split choices.
"""

from __future__ import annotations

import logging
import math

import numpy as np
from sklearn.ensemble import IsolationForest

logger = logging.getLogger("IsolationForestDetector")

#: The link measurements the detector reads.
MEASUREMENTS = (
    "slant_range_km",
    "doppler_shift_hz",
    "rssi_dbm",
    "snr_db",
    "received_phase_error_deg",
)
FEATURES = ("phase_error_magnitude_deg", "range_normalised_power_db", "noise_floor_dbm")


def derived_features(link: dict) -> list[float]:
    return [
        abs(float(link["received_phase_error_deg"])),
        float(link["rssi_dbm"]) + 20.0 * math.log10(float(link["slant_range_km"])),
        float(link["rssi_dbm"]) - float(link["snr_db"]),
    ]


class MLAnomalyDetector:
    def __init__(
        self, contamination: float = 0.01, n_estimators: int = 256, random_state: int = 42
    ):
        self.model = IsolationForest(
            n_estimators=n_estimators, contamination=contamination, random_state=random_state
        )
        self.mean: np.ndarray | None = None
        self.scale: np.ndarray | None = None

    @property
    def is_trained(self) -> bool:
        return self.mean is not None

    def _standardise(self, links) -> np.ndarray:
        return (np.array([derived_features(link) for link in links]) - self.mean) / self.scale

    def fit(self, nominal_links: list[dict]) -> MLAnomalyDetector:
        """Trains on clean link measurements only."""
        if len(nominal_links) < 50:
            raise ValueError("train on at least 50 nominal measurements")
        x = np.array([derived_features(link) for link in nominal_links])
        self.mean = x.mean(axis=0)
        spread = x.std(axis=0)
        self.scale = np.where(spread > 0, spread, 1.0)
        self.model.fit(self._standardise(nominal_links))
        logger.info("Isolation Forest trained on %d nominal measurements", len(x))
        return self

    def evaluate_packet(self, link_packet: dict) -> dict:
        if not self.is_trained:
            raise RuntimeError("train the detector on nominal passes first")
        features = self._standardise([link_packet])
        # One scoring pass: predict() is exactly decision_function() < 0.
        score = float(self.model.decision_function(features)[0])
        is_anomaly = score < 0.0
        return {
            "layer": "Statistical Layer (ML)",
            # Positive for inliers, negative for outliers; the decision threshold is zero.
            "anomaly_score": score,
            "threat_detected": is_anomaly,
            "verdict": "ML_ANOMALY_FLAGGED" if is_anomaly else "ML_NOMINAL_INLIER",
        }


#: The live site's per-frame forest (dashboard/src/sim/linkDetector.ts): its four features.
SITE_FEATURES = ("carrier_residual_mhz", "power_residual_db", "carrier_step_mhz", "power_step_db")
#: Consecutive training measurements further apart than this start a new sequence (no step).
SITE_SEQUENCE_GAP_S = 2.0


def site_residuals(link: dict, predicted: dict) -> tuple[float, float]:
    """Measured carrier minus the orbit-predicted carrier (MHz), measured power minus budget."""
    return (
        (float(link["doppler_shift_hz"]) - float(predicted["doppler_shift_hz"])) / 1e6,
        float(link["rssi_dbm"]) - float(predicted["rssi_dbm"]),
    )


class SiteFrameForest:
    """The site's per-frame Isolation Forest, re-implemented with the same features and settings.

    Four features: the carrier and power residuals against the orbit prediction, and their
    change since the last packet the whole pipeline delivered. 256 trees of 256 samples each,
    trained on 3,000 nominal frames, flagging at the 1 % contamination point of the training
    scores, as linkDetector.ts does in the browser.
    """

    def __init__(
        self, contamination: float = 0.01, n_estimators: int = 256, random_state: int = 42
    ):
        self.model = IsolationForest(
            n_estimators=n_estimators,
            max_samples=256,
            contamination=contamination,
            random_state=random_state,
        )
        self.reference: tuple[float, float] | None = None
        self.trained = False

    def fit(self, measurements: list[tuple[float, dict, dict]]) -> SiteFrameForest:
        """Trains on (time, measured link, predicted link) of consecutive nominal frames."""
        rows, previous, last_t = [], None, None
        for t, link, predicted in measurements:
            r = site_residuals(link, predicted)
            if previous is None or last_t is None or t - last_t > SITE_SEQUENCE_GAP_S:
                rows.append([r[0], r[1], 0.0, 0.0])
            else:
                rows.append([r[0], r[1], r[0] - previous[0], r[1] - previous[1]])
            previous, last_t = r, t
        self.model.fit(np.array(rows))
        self.trained = True
        return self

    def features(self, link: dict, predicted: dict) -> list[float]:
        r = site_residuals(link, predicted)
        ref = self.reference
        return [r[0], r[1], r[0] - ref[0] if ref else 0.0, r[1] - ref[1] if ref else 0.0]

    def evaluate(self, link: dict, predicted: dict) -> dict:
        if not self.trained:
            raise RuntimeError("train the forest on nominal frames first")
        score = float(self.model.decision_function(np.array([self.features(link, predicted)]))[0])
        return {"anomaly_score": score, "threat_detected": score < 0.0}

    def accept(self, link: dict, predicted: dict) -> None:
        """Only packets the whole pipeline delivered become the reference for the steps."""
        self.reference = site_residuals(link, predicted)
