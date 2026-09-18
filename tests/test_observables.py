import numpy as np

from core.observables import LinkConfig, generate


def test_shapes_and_clean_labels():
    obs = generate(LinkConfig(epochs=120, n_channels=6))

    assert obs.cn0_db.shape == (120, 6)
    assert obs.pseudorange_residual_m.shape == (120, 6)
    assert obs.agc_db.shape == (120,)
    assert obs.labels.sum() == 0


def test_generation_is_reproducible():
    a = generate(LinkConfig(seed=7))
    b = generate(LinkConfig(seed=7))

    np.testing.assert_allclose(a.cn0_db, b.cn0_db)


def test_clock_bias_follows_the_configured_drift():
    config = LinkConfig(epochs=400, clock_drift_ns_per_s=5.0, clock_jitter_ns=0.0)
    obs = generate(config)

    elapsed = (obs.epochs - 1) * config.epoch_seconds
    assert obs.clock_bias_ns[-1] == elapsed * config.clock_drift_ns_per_s


def test_copy_does_not_alias_the_original():
    obs = generate(LinkConfig(epochs=20))
    clone = obs.copy()
    clone.cn0_db[0, 0] += 10.0

    assert obs.cn0_db[0, 0] != clone.cn0_db[0, 0]
