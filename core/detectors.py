"""Statistical detectors over the feature stream.

The detector is fitted on a clean prefix of the record — the operator's quiet period — and
then scores every epoch. Robust statistics (median / MAD) are used so that a short attack
inside the fitting window cannot quietly widen the baseline.

Both the CUSUM drift and the alarm threshold are calibrated from the clean prefix against a
target false-alarm rate, so the operating point is stated up front rather than hand-tuned.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .features import FEATURE_NAMES

_MAD_TO_SIGMA = 1.4826


@dataclass
class RobustBaseline:
    """Per-feature robust location and scale."""

    center: np.ndarray = field(default_factory=lambda: np.empty(0))
    scale: np.ndarray = field(default_factory=lambda: np.empty(0))

    def fit(self, features: np.ndarray) -> RobustBaseline:
        if features.ndim != 2 or features.shape[0] < 2:
            raise ValueError("need at least two epochs of clean features to fit a baseline")
        self.center = np.median(features, axis=0)
        mad = np.median(np.abs(features - self.center), axis=0)
        # Floor the scale so a feature that is constant in the quiet period cannot produce
        # an infinite z-score on its first natural wobble.
        self.scale = np.maximum(mad * _MAD_TO_SIGMA, 1e-3)
        return self

    def z_scores(self, features: np.ndarray) -> np.ndarray:
        return (features - self.center) / self.scale


@dataclass
class GroundLinkDetector:
    """Max-|z| detector with a CUSUM stage for slow-onset attacks.

    ``target_pfa`` is the per-epoch false-alarm rate the operating point is calibrated to on
    the clean prefix. ``cusum_weight`` sets how much the accumulated evidence contributes
    relative to the instantaneous statistic; raising it trades detection latency for
    sensitivity to gradual onsets.
    """

    target_pfa: float = 0.01
    cusum_weight: float = 0.35
    baseline: RobustBaseline = field(default_factory=RobustBaseline)
    cusum_drift: float = float("nan")
    threshold: float = float("nan")

    def fit(self, clean_features: np.ndarray) -> GroundLinkDetector:
        if not 0.0 < self.target_pfa < 1.0:
            raise ValueError("target_pfa must lie strictly between 0 and 1")

        self.baseline.fit(clean_features)

        # Drift must sit above the nominal instantaneous statistic, otherwise the
        # accumulator ratchets upward on clean data and every later epoch alarms.
        instantaneous = self._instantaneous(clean_features)
        self.cusum_drift = float(np.quantile(instantaneous, 1.0 - self.target_pfa))

        clean_scores = self._combine(instantaneous)
        self.threshold = float(np.quantile(clean_scores, 1.0 - self.target_pfa))
        return self

    def _instantaneous(self, features: np.ndarray) -> np.ndarray:
        return np.abs(self.baseline.z_scores(features)).max(axis=1)

    def _combine(self, instantaneous: np.ndarray, threshold: float | None = None) -> np.ndarray:
        """Accumulate evidence, restarting after each declaration.

        Without the restart the accumulator stays elevated long after an attack ends and
        every subsequent clean epoch is counted as a false alarm.
        """
        scores = np.zeros(instantaneous.shape[0])
        accumulator = 0.0
        for i, value in enumerate(instantaneous):
            accumulator = max(0.0, accumulator + value - self.cusum_drift)
            scores[i] = value + self.cusum_weight * accumulator
            if threshold is not None and scores[i] >= threshold:
                accumulator = 0.0
        return scores

    def score(self, features: np.ndarray) -> np.ndarray:
        """Return the per-epoch detection statistic."""
        threshold = None if np.isnan(self.threshold) else self.threshold
        return self._combine(self._instantaneous(features), threshold)

    def alarms(self, features: np.ndarray) -> np.ndarray:
        return (self.score(features) >= self.threshold).astype(int)

    def attribute(self, features: np.ndarray, epoch: int) -> str:
        """Name the feature that drove the statistic at ``epoch``."""
        z = np.abs(self.baseline.z_scores(features))
        return FEATURE_NAMES[int(np.argmax(z[epoch]))]
