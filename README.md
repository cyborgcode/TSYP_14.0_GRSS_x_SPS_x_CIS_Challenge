# Ground Truth Under Attack — Track 1: Secure Ground-Link Testbed

A verifiable defensive prototype for the Earth-observation ground segment: it seals receiver
observables under a software trust anchor, injects controlled interference, and detects the
attack while reporting detection quality, false alarms and latency.

## Why

Earth-observation products drive decisions in agriculture, insurance, water management and
disaster response. Jamming, spoofing and replay can make a pipeline produce plausible but
untrustworthy output — and the failure is silent: the pipeline keeps running while a
corrupted observation reaches the analyst. This testbed makes that failure visible.

## Requirements

- Python 3.11+
- Node.js 22 (dashboard only — `.nvmrc` provided)

## Getting started

```bash
git clone <repository-url>
cd <repository>
pip install -e ".[dev]"
```

Run the standard scenario:

```bash
python -m core.cli --attack spoofing
```

Swap in any attack from the catalogue:

```bash
python -m core.cli --attack jamming
python -m core.cli --attack meaconing
python -m core.cli --attack spoofing --onset 200 --duration 80 --pfa 0.005
```

Run the test suite:

```bash
python -m pytest
```

## Results on the standard scenario

600 epochs, 8 channels, attack from epoch 300 for 120 epochs, detector calibrated to a 1%
target false-alarm rate on a clean 250-epoch prefix:

| Attack | Pd | Pfa | ROC AUC | Driving feature |
| --- | --- | --- | --- | --- |
| Jamming | 1.000 | 0.010 | 1.000 | `cn0_mean` |
| Spoofing | 1.000 | 0.015 | 0.996 | `cn0_mean` |
| Meaconing | 1.000 | 0.010 | 1.000 | `residual_common_mode` |

Post-hoc edits to the sealed log are caught by the trust anchor in every run.

**These figures are from synthetic observables.** They demonstrate that the harness works
end to end; they are not submittable results. The official reference datasets must replace
the generator before anything is reported — see `docs/roadmap.md`.

## Repository layout

```
core/                 detection pipeline
  observables.py      nominal link model
  attacks.py          controlled adversarial injection
  features.py         per-epoch interpretable features
  detectors.py        robust baseline + CUSUM, calibrated operating point
  trust.py            HMAC-SHA256 hash-chained observation log
  evaluate.py         Pd, Pfa, latency, ROC AUC
  cli.py              end-to-end scenario runner
dashboard/            React app — Phase 2 replay and demo surface
docs/                 threat model, architecture, roadmap
data/                 reference datasets (gitignored)
tests/                Python test suite
```

## Documentation

- [Threat model](docs/threat-model.md)
- [Architecture and trust anchor](docs/architecture.md)
- [Roadmap to Phase 1](docs/roadmap.md)
- [Working agreement](CONTRIBUTING.md)

## Dashboard

```bash
cd dashboard
npm install
npm run dev
```
