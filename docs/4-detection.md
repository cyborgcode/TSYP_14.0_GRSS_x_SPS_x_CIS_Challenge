# 4 · AI or Statistical Detection

> Phase 1 weight: **20 points** — detector design & evaluation

## Design

`groundlink/detector.py` — trained on **clean traffic only**. A real station has hours of
normal contacts and almost no labelled attacks, so the model learns a healthy link and
flags departures from it. It never sees an attack during training.

Two scorers, each covering the other's blind spot:

| Scorer | Catches | Misses on its own |
| --- | --- | --- |
| **Isolation Forest** (200 trees, robust-scaled features) | *Joint* anomalies: several features each slightly off, in a combination never seen clean | A *single* feature far out of range — scores saturate at the training extremes |
| **Robust per-feature gate** (largest median/IQR deviation) | A single feature far out of range | Subtle multi-feature combinations |

The gap is not theoretical. With Isolation Forest alone, the delay attack — latency +80 ms,
every other feature normal — was caught on only **17–35%** of frames (median 26%, across
10 training seeds). With the hybrid, 100% on every seed.

## Calibration

Three independent clean passes:

1. **Train** — fit the scaler and the forest.
2. **Calibrate** — normalise each scorer by its own quantile, merge with a max, and set the
   alarm threshold at the (1 − target Pfa) quantile.
3. **Test** — the pass that gets attacked.

The false-alarm rate is therefore stated up front and measured on data the model never
trained on. Tie-breaks in this challenge go to the lower false-alarm rate, so the operating
point has to be explicit.

## Evaluation protocol

- **Pd** — fraction of attacker-produced or attacker-altered frames that raise an alarm.
- **Pfa** — fraction of frames in the **quiet period** (outside the attack window) that
  raise an alarm. Genuine frames *inside* the window are excluded from both rates: their
  sequence and arrival-gap features are legitimately disturbed by the attacker's
  interleaved frames, so counting them as false alarms would misstate the detector.
- **ROC AUC** — threshold-free ranking quality of the detector's score.

## Results — standard scenario (synthetic)

Attack window 200–260 s of a 600 s pass, target Pfa 1%:

| Attack | Crypto Pd | ML Pd | Combined Pd | Combined Pfa | ML AUC | Caught by | Driving feature |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tamper | 1.000 | 0.000 | 1.000 | 0.012 | 0.512 | crypto | — |
| Inject | 1.000 | 1.000 | 1.000 | 0.012 | 1.000 | crypto + ML | `doppler_residual_hz` |
| Replay | 1.000 | 1.000 | 1.000 | 0.012 | 1.000 | crypto + ML | `latency_residual_ms` |
| Relay | 0.000 | 1.000 | 1.000 | 0.012 | 1.000 | ML | `latency_residual_ms` |
| Delay | 0.000 | 1.000 | 1.000 | 0.012 | 1.000 | ML | `latency_residual_ms` |
| Jamming | 0.000 | 1.000 | 1.000 | 0.012 | 1.000 | ML | `inter_arrival_ms` |

Reproduce with `python -m groundlink.cli`.

Read the table by column: **no single layer catches everything.** Tamper is invisible to
the detector (AUC 0.512 — chance), because it changes bytes, not physics. Relay, delay and
jamming are invisible to cryptography. Only the combination covers the catalogue.

## Overhead

Indicative, development laptop, per frame:

| Cost | Value |
| --- | --- |
| Authentication tag | 16 bytes (16.2% of a 99-byte frame) |
| Cryptographic processing | ~13 µs |
| Detector scoring | ~9 µs |
| Detector training | ~0.3 s for one 6000-frame pass |
| Model size | ~2.4 MiB |

At 10 frames/s both layers use well under 0.1% of one core.

## Honest caveats

- **These figures are from synthetic traffic** and are not submittable. They show the
  harness works end to end.
- Perfect scores mean the attacks are at full strength. Deliverable 5 exists to find where
  detection breaks.
