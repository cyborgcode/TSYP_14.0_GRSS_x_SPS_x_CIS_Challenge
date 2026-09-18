import numpy as np
import pytest

from core.attacks import Window, broadband_jamming, meaconing, spoofing
from core.detectors import GroundLinkDetector, RobustBaseline
from core.features import FEATURE_NAMES, extract
from core.observables import LinkConfig, generate

CONFIG = LinkConfig(epochs=600, seed=11)
WINDOW = Window(300, 420)
TRAIN_EPOCHS = 250


def fitted_detector(clean, target_pfa=0.01):
    return GroundLinkDetector(target_pfa=target_pfa).fit(extract(clean)[:TRAIN_EPOCHS])


def test_feature_matrix_matches_the_declared_names():
    obs = generate(CONFIG)
    assert extract(obs).shape == (obs.epochs, len(FEATURE_NAMES))


def test_baseline_rejects_too_little_data():
    with pytest.raises(ValueError):
        RobustBaseline().fit(np.zeros((1, 3)))


def test_baseline_floors_the_scale_on_a_constant_feature():
    baseline = RobustBaseline().fit(np.zeros((50, 2)))
    assert np.all(baseline.scale > 0.0)
    assert np.all(np.isfinite(baseline.z_scores(np.ones((1, 2)))))


def test_target_pfa_must_be_a_probability():
    with pytest.raises(ValueError):
        GroundLinkDetector(target_pfa=1.5).fit(np.zeros((10, 6)))


def test_false_alarm_rate_tracks_the_target_on_clean_data():
    clean = generate(CONFIG)
    detector = fitted_detector(clean, target_pfa=0.01)

    held_out = extract(clean)[TRAIN_EPOCHS:]
    assert detector.alarms(held_out).mean() <= 0.05


@pytest.mark.parametrize(
    ("attack", "expected_driver"),
    [
        (broadband_jamming, "cn0_mean"),
        (spoofing, "cn0_mean"),
        (meaconing, "residual_common_mode"),
    ],
)
def test_every_attack_is_detected_and_attributed(attack, expected_driver):
    clean = generate(CONFIG)
    detector = fitted_detector(clean)
    features = extract(attack(clean, WINDOW))

    alarms = detector.alarms(features)
    assert alarms[WINDOW.slice()].mean() > 0.9
    assert detector.attribute(features, WINDOW.start + 50) == expected_driver


def test_accumulator_restarts_so_alarms_do_not_persist_after_the_attack():
    clean = generate(CONFIG)
    detector = fitted_detector(clean)
    features = extract(broadband_jamming(clean, WINDOW))

    after = detector.alarms(features)[WINDOW.end + 20 :]
    assert after.mean() < 0.05
