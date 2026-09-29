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

- **3D ground link**: a 542.8 km sun-synchronous LEO pass over the Zaghouan (Tunisia) ground
  station in real-time WebGL (ACES Filmic tone mapping, layered atmospheric scattering, gold MLI
  satellite bus). Click the satellite or the station to fly in and watch the signal live.
- **One continuous signal beam**: its colour and distortion, the Carrier Frequency (MHz) and RSSI
  (dBm) charts (Chart.js), the received spectrum, the security banner and the ledger all change
  together with the scenario.
- **Three attack scenarios**: Frequency Hijacking (rogue carrier +14.2 MHz, carrier to ~8492 MHz,
  proof failures), Stealth Spoofing (forged MAC headers and nonces from node 0x99A2, quarantine
  protocols) and Noise Jamming (RSSI to −96.5 dBm, fallback routing to GS-MAT). **Play demo**
  runs all three back to back.
- **trust_anchor.py terminal**: live log of SHA-256 block validations from a genesis root hash,
  HMAC-SHA256 frame seals and Ed25519 handshakes, all computed with Web Crypto in the browser.
- **Detection**: orbital-physics gates, the trust anchor and an Isolation Forest trained on
  nominal passes at load, fused by a 2-of-3 vote. Tiles marked *sample* are placeholders until
  measured on the official reference dataset.

The step-by-step evaluation walkthrough is in [docs/evaluation-guide.md](docs/evaluation-guide.md).

```bash
cd dashboard
npm install
npm run dev
```

Production deploys are triggered manually by the Vercel project owner; automatic Git deploys are
off in `vercel.json`.
