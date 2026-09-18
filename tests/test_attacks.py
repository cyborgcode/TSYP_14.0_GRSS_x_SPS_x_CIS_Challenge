import pytest

from core.attacks import Window, broadband_jamming, meaconing, spoofing
from core.observables import LinkConfig, generate

CONFIG = LinkConfig(epochs=300, seed=3)
WINDOW = Window(150, 250)


@pytest.fixture
def clean():
    return generate(CONFIG)


def test_window_rejects_an_empty_range():
    with pytest.raises(ValueError):
        Window(10, 10)


@pytest.mark.parametrize("attack", [broadband_jamming, spoofing, meaconing])
def test_attacks_label_exactly_their_window(clean, attack):
    attacked = attack(clean, WINDOW)

    assert attacked.labels[WINDOW.slice()].all()
    assert attacked.labels.sum() == WINDOW.end - WINDOW.start
    assert clean.labels.sum() == 0, "the clean record must not be mutated"


def test_jamming_suppresses_carrier_to_noise_and_backs_off_agc(clean):
    attacked = broadband_jamming(clean, WINDOW, jam_power_db=12.0)

    assert attacked.cn0_db[WINDOW.slice()].mean() < clean.cn0_db[WINDOW.slice()].mean() - 5.0
    assert attacked.agc_db[WINDOW.slice()].mean() < clean.agc_db[WINDOW.slice()].mean() - 2.0


def test_spoofing_collapses_inter_channel_spread_while_agc_holds(clean):
    attacked = spoofing(clean, WINDOW)

    clean_spread = clean.cn0_db[WINDOW.slice()].std(axis=1).mean()
    attacked_spread = attacked.cn0_db[WINDOW.slice()].std(axis=1).mean()

    assert attacked_spread < clean_spread * 0.5
    # The AGC is untouched: an AGC-only monitor is blind to this attack.
    assert attacked.agc_db[WINDOW.slice()] == pytest.approx(clean.agc_db[WINDOW.slice()])


def test_meaconing_shifts_every_channel_by_a_common_bias(clean):
    delay = 45.0
    attacked = meaconing(clean, WINDOW, delay_m=delay)

    shift = (
        attacked.pseudorange_residual_m[WINDOW.slice()]
        - clean.pseudorange_residual_m[WINDOW.slice()]
    )
    assert shift == pytest.approx(delay)
