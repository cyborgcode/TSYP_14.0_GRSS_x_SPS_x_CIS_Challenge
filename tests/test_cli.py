import pytest

from core.attacks import ATTACKS
from core.cli import run


@pytest.mark.parametrize("attack", sorted(ATTACKS))
def test_standard_scenario_detects_every_attack_within_the_target_false_alarm_rate(attack):
    result = run(attack=attack, onset=300, duration=120, target_pfa=0.01, train_epochs=250, seed=0)

    assert result["metrics"]["Pd"] > 0.9
    assert result["metrics"]["Pfa"] < 0.05
    assert result["metrics"]["roc_auc"] > 0.95


def test_the_sealed_record_verifies_and_tampering_is_caught():
    result = run(
        attack="spoofing", onset=300, duration=120, target_pfa=0.01, train_epochs=250, seed=0
    )
    anchor = result["trust_anchor"]

    assert anchor["epochs_sealed"] == 600
    assert anchor["chain_valid"]
    assert anchor["tamper_detected"]


def test_training_window_may_not_overlap_the_attack():
    with pytest.raises(SystemExit):
        run(
            attack="jamming",
            onset=100,
            duration=50,
            target_pfa=0.01,
            train_epochs=150,
            seed=0,
        )


def test_unknown_attack_is_rejected():
    with pytest.raises(SystemExit):
        run(
            attack="nonexistent",
            onset=300,
            duration=60,
            target_pfa=0.01,
            train_epochs=250,
            seed=0,
        )
