# Ground Truth Under Attack — Track 1: Secure Ground-Link Testbed

Protects the radio link that carries data from a satellite down to its ground station, and
detects when someone interferes with it — including the attacks that encryption alone can't
see.

**New to the project? Read [docs/START-HERE.md](docs/START-HERE.md) first.**

## The idea in one paragraph

Every frame the satellite sends is encrypted and sealed with AES-256-GCM, so any altered,
forged or replayed frame is rejected. But an attacker can also *forward*, *delay* or *jam*
genuine frames — every cryptographic check still passes, and the station quietly accepts
data from a path the attacker controls. So a second, independent layer compares how each
frame physically arrived (timing, power, Doppler) with what the satellite's orbit predicts,
and a machine-learning detector flags anything that doesn't fit.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m groundlink.cli
python -m pytest
```

Run a single attack, or change the attack window and false-alarm target:

```bash
python -m groundlink.cli --attack relay
python -m groundlink.cli --attack delay --attack jamming --start 100 --end 150 --pfa 0.005
```

## Standard scenario — what it shows

| Attack | Crypto catches | ML catches | Together | False alarms |
| --- | --- | --- | --- | --- |
| Tamper | ✅ 100% | ❌ 0% | 100% | 1.2% |
| Inject | ✅ 100% | ✅ 100% | 100% | 1.2% |
| Replay | ✅ 100% | ✅ 100% | 100% | 1.2% |
| Relay | ❌ 0% | ✅ 100% | 100% | 1.2% |
| Delay | ❌ 0% | ✅ 100% | 100% | 1.2% |
| Jamming | ❌ 0% | ✅ 100% | 100% | 1.2% |

**These figures are from synthetic traffic** and are not submittable results. The official
reference datasets must replace the simulator before anything is reported.

## Repository layout

```
groundlink/
  frames.py        frame header layout
  security.py      AES-256-GCM sealing, anti-replay, freshness   ← layer 1
  channel.py       orbit geometry: range, Doppler, power
  simulate.py      clean satellite-to-station traffic
  attacks.py       six attacks with ground-truth labels
  station.py       runs both layers on every frame, extracts features
  detector.py      hybrid anomaly detector                       ← layer 2
  audit.py         tamper-evident station log
  evaluate.py      detection metrics
  cli.py           standard scenario runner
tests/             59 tests
docs/              one document per deliverable, plus roadmap and decisions
dashboard/         React app — the Phase 2 live-demo surface
data/              official datasets (gitignored)
```

## Deliverables

| # | Deliverable | Points | Document |
| --- | --- | --- | --- |
| 1 | Threat Model & Segment Analysis | 15 | [docs/1-threat-model.md](docs/1-threat-model.md) |
| 2 | Platform / Architecture & Trust Anchor | 15 | [docs/2-architecture-trust-anchor.md](docs/2-architecture-trust-anchor.md) |
| 3 | Signal / Image Processing | 15 | [docs/3-signal-processing.md](docs/3-signal-processing.md) |
| 4 | AI or Statistical Detection | 20 | [docs/4-detection.md](docs/4-detection.md) |
| 5 | Adversarial Validation & Response | 20 | [docs/5-adversarial-validation.md](docs/5-adversarial-validation.md) |
| 6 | Documentation & Official Datasets | 5–10 | [docs/6-datasets-reproducibility.md](docs/6-datasets-reproducibility.md) |

Also: [team roles](docs/roles.md) · [roadmap](docs/roadmap.md) · [decision log](docs/decisions.md) ·
[working agreement](CONTRIBUTING.md)

## Live testbed (dashboard)

`dashboard/` is the interactive web testbed, deployed on Vercel from `main`:

- **3D ground link**: an S2A pass over GS-LAB in real-time WebGL. Click the satellite or the
  station to fly in and watch the signal live: frames being sealed on board (real HMAC-SHA256),
  the received spectrum waterfall, QPSK constellations and per-frame verification at the gate.
- **Four attack scenarios** (spoofed frame, replayed pass, RF jamming, Doppler mimic) wired live
  to the 3D view, telemetry, ledger and detectors; the attack-power slider drives jamming
  continuously. **Play demo** runs the replayable standard-scenario sequence.
- **Everything runs in the browser**: Web Crypto HMAC-SHA256 + anti-replay window + SHA-256
  hash chain, an Isolation Forest trained on nominal passes at load, and 2-of-3 fusion.
  Tiles marked *sample* are placeholders until measured on the official reference dataset.

```bash
cd dashboard
npm install
npm run dev
```

Every push to `main` that passes CI is deployed to production by the `Deploy to Vercel` job in
`.github/workflows/ci.yml`. It needs three repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`
and `VERCEL_PROJECT_ID`. Until they are set, the job is skipped with a warning.
