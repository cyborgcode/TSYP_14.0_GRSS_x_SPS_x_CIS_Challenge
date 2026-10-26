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

Run the red-team audit and measure the four dashboard attacks
([evaluation report](docs/evaluation-report.md)):

```bash
python -m testbed.validator
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

## Digital twin — SGP4 orbit, CCSDS packets, three security layers

`digital_twin/` builds the source-code architecture end to end: 13 modules in three phases
([its README](digital_twin/README.md)). An SGP4 orbit and an X-band link budget with ITU-R
P.618 path loss give the truth at every instant; the satellite frames its telemetry as a CCSDS
space packet (CRC-16) sealed with SHA-256 and HMAC-SHA256; a red team attacks what arrives; and
three independent layers judge it. Crypto or physics failing rejects the packet, the Isolation
Forest alone holds it for review, and every decision goes to a hash-chained audit log rooted in
the testbed's genesis block. Uplink commands are sealed the same way: a tampered or injected
telecommand is rejected on board.

```bash
pip install -e ".[dev,twin]"
python -m digital_twin.physics_validator
uvicorn digital_twin.api_gateway:app
streamlit run digital_twin/dashboard_ui.py
```

The physics layer is a chi-square test on four residuals against the orbit prediction (range,
Doppler, RSSI, carrier phase), each divided by its natural noise:

$$\chi^2=\sum_{i=1}^{4}\left(\frac{x_i^{\text{rx}}-x_i^{\text{SGP4}}}{\sigma_i}\right)^2>\chi^2_{4}\left(1-10^{-4}\right)\left(1+2e^{-\theta/6^\circ}\right)$$

The gate is 23.5 at high elevation and widens up to 3× toward the 2° mask, where the residuals
spread. The expected RSSI carries the ITU-R P.618-13 attenuation (gases P.676, rain P.838 and
P.839, clouds P.840, scintillation), with the ITU-R map values at Zaghouan: the median
atmosphere for the live link, about 1 dB at the mask, and the fade exceeded p % of the year for
margins (at 10° elevation: 2.2 dB for 99.9 %, 5.4 dB for 99.99 %). A second test, kinematic
coupling, needs no orbit at all: the range change since the last trusted measurement must equal
the integrated Doppler,

$$\Delta\rho=-\frac{c}{f_c}\int_{t_0}^{t_1}f_d\,dt$$

checked against the range and Doppler noise at the same $10^{-4}$ false-alarm rate. It catches
the step of a meaconer's delay even with a stale element set.

One pass per threat vector over Zaghouan on the fixed LEO-SAT orbit (`GROUNDLINK_OFFLINE=1`), the
threat active from 30% to 70% of it:

| Threat vector | Stopped | Crypto | Physics | Kinematic | ML | Clean ticks held |
| --- | --- | --- | --- | --- | --- | --- |
| None | — | 0% | 0% | 0% | 0% | 2% |
| Delay spoofing (meaconing, +72.5 km) | 100% | 0% | 100% | 12% (onset) | 100% | 0% |
| Coherent phase slip (+47°, +18 Hz) | 100% | 0% | 100% | 0% | 100% | 0% |
| CCSDS sequence hijack (+512, SAFE_HOLD) | 100% | 100% | 0% | 0% | 0% | 0% |
| Uplink command tampering / injection | 100% | 100% | — | — | — | — |

**Live orbit.** The twin flies a real satellite on its current orbit: by default TerraSAR-X
(NORAD 31698), an X-band radar satellite on a ~510 km sun-synchronous orbit, with its latest
element set downloaded from CelesTrak's public GP service at start-up. A download is reused for
two hours, as CelesTrak asks; when the network or CelesTrak fails, the twin flies the last good
download, and if it was never online, the built-in LEO-SAT reference orbit. `/health`, `/orbit`,
the dashboard and the red-team report all say which orbit is flown and where it came from. CI
checks the live download on every push:

```bash
python -m digital_twin.ephemeris_loader --require-live
```

`GROUNDLINK_NORAD_ID` picks another satellite, `GROUNDLINK_OFFLINE=1` stays off the network
(the test suite runs this way, on the fixed LEO-SAT orbit), `GROUNDLINK_TLE_CACHE` moves the
cache. The HMAC key comes from `GROUNDLINK_HMAC_KEY` (hex) and is random per run when unset; the
audit log path from `GROUNDLINK_AUDIT_LOG` (default `security_audit.jsonl`). The orbit is live;
the RF measurements and attacks are **synthetic**, like the standard scenario above.

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
testbed/           the dashboard's four attacks as Python modules
  ingester.py      telemetry + red-team attacks (hijack, spoofing, jamming, data tampering)
  detector.py      physics gate + Isolation Forest on orbit residuals
  trust_anchor.py  HMAC-SHA256 + anti-replay + SHA-256 ledger from a genesis block
  zero_trust.py    policy engine: registry, token, trust anchor, detector
  validator.py     red-team audit and the measured evaluation report
digital_twin/      SGP4 digital twin of the ground link, 13 modules
  ephemeris_loader.py           phase 1: live CelesTrak TLE, cached, offline fallback
  propagation.py                SGP4 with J2-J4 zonal harmonics, state in TEME
  link_budget.py                range, Doppler, ITU-R P.618 path loss, SNR, RSSI
  visibility_calculator.py      look angles and passes over Zaghouan
  ccsds_framing.py              phase 2: CCSDS space packet with CRC-16
  attack_injector.py            meaconing, phase slip, sequence hijack, uplink forgery
  crypto_hash_verifier.py       SHA-256 + HMAC-SHA256                  ← data layer
  isolation_forest_detector.py  Isolation Forest on link features      ← statistical layer
  security_detector.py          chi-square gate + kinematic coupling   ← physical layer
  audit_logger.py               phase 3: hash-chained JSONL audit log
  physics_validator.py          master orchestrator and red-team report
  api_gateway.py                FastAPI service
  dashboard_ui.py               Streamlit causal-chain inspector
tests/             126 tests
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
- **Simulate attack**: Stealth Spoofing (forged MAC headers and nonces from node 0x99A2,
  quarantine protocols), Data Tampering (one payload bit flipped in transit: no RF signature,
  only hash verification sees it), Frequency Hijacking (rogue carrier +14.2 MHz, carrier to
  ~8492 MHz, proof failures) and Noise Jamming (RSSI to −96.5 dBm, fallback routing to GS-MAT).
  **Play demo** runs all four back to back.
- **Packet inspection drawer**: every frame as it went through browser ports of
  `trust_anchor.py`, `detector.py` and `zero_trust.py`: raw frame and payload hexdump (flipped
  bits highlighted), MAC received against MAC recomputed, nonce check, ledger block and
  `verify_chain()`, detector features against the physics limits, Isolation Forest score and
  confidence, and the access decision with its reasons.
- **Resilience & trust metrics**: authenticated, rejected, held and corrupted-to-analyst
  counts; live `verify_chain()` with a red-team "edit a past block" test; and per-scenario
  detection by layer (trust anchor, detector, dropped, time to first drop).
- **Hiding in the noise**, on its own pages linked from the top bar: `/signal` (the chosen
  signal (carrier 8477.8 MHz, ±197.7 kHz Doppler, received at −88.0 to −74.9 dBm, i.e. a
  12.5–57.1 µV peak across 50 Ω, over a −100 dBm noise floor), `/attacks` (three ways an attacker
  imitates natural noise), `/protection` (an interactive stealth budget and the four layers) and
  `/noise` (a narrated explainer video; source and re-render steps in `dashboard/explainer/`).
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
