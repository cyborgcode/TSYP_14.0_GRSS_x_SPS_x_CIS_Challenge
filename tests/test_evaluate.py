import numpy as np

from core.evaluate import detection_latency, roc_auc, score_run


def test_roc_auc_is_one_for_a_perfect_ranking():
    assert roc_auc(np.array([0.0, 1.0, 2.0, 3.0]), np.array([0, 0, 1, 1])) == 1.0


def test_roc_auc_is_half_when_every_score_ties():
    assert roc_auc(np.ones(8), np.array([0, 1] * 4)) == 0.5


def test_roc_auc_is_undefined_without_both_classes():
    assert np.isnan(roc_auc(np.arange(5.0), np.zeros(5, dtype=int)))


def test_latency_counts_epochs_from_onset():
    labels = np.array([0, 0, 1, 1, 1])
    alarms = np.array([0, 0, 0, 1, 1])

    assert detection_latency(alarms, labels) == 1.0


def test_latency_is_infinite_when_the_attack_is_missed():
    labels = np.array([0, 1, 1])
    alarms = np.zeros(3, dtype=int)

    assert detection_latency(alarms, labels) == float("inf")


def test_score_run_separates_detection_from_false_alarms():
    labels = np.array([0, 0, 1, 1])
    alarms = np.array([1, 0, 1, 1])
    scores = np.array([0.5, 0.1, 0.9, 0.95])

    metrics = score_run(scores, alarms, labels)

    assert metrics.probability_of_detection == 1.0
    assert metrics.false_alarm_rate == 0.5
