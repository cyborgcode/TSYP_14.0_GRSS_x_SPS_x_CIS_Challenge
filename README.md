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

One pass per threat vector over Zaghouan on TerraSAR-X's built-in element set
(`GROUNDLINK_OFFLINE=1`), the threat active from 30% to 70% of it:

| Threat vector | Stopped | Crypto | Physics | Kinematic | ML | Clean ticks held |
| --- | --- | --- | --- | --- | --- | --- |
| None | — | 0% | 0% | 0% | 0% | 0% |
| Delay spoofing (meaconing, +72.5 km) | 100% | 0% | 100% | 13% (onset) | 100% | 0% |
| Coherent phase slip (+47°, +18 Hz) | 100% | 0% | 100% | 0% | 100% | 0% |
| CCSDS sequence hijack (+512, SAFE_HOLD) | 100% | 100% | 0% | 0% | 0% | 3% |
| Uplink command tampering / injection | 100% | 100% | — | — | — | — |

The evaluation behind the report, `python -m digital_twin.evaluate`, runs the three tiers and the
site's decision rule against eight attacks (the four of the live demo plus replay, relay, delay
and injection), two below-the-gate jams and three uplink threats, over six seeds: no attack packet
reaches the analyst, 0.7–1.5 % of genuine packets are held, and the chi-square engine raises 2
false alarms in 45,000 clean packets ([docs/evaluation-report.md](docs/evaluation-report.md)).

**Live orbit.** The twin flies TerraSAR-X (NORAD 31698), an X-band radar satellite on a 514 km
sun-synchronous orbit, on its current orbit: its latest element set is downloaded from
CelesTrak's public GP service at start-up. A download is reused for two hours, as CelesTrak asks;
when the network or CelesTrak fails, the twin flies the last good download, and if it was never
online, the TerraSAR-X element set built into it (as CelesTrak served it on 27 October 2026). `/health`, `/orbit`,
the dashboard and the red-team report all say which orbit is flown and where it came from. CI
checks the live download on every push:

```bash
python -m digital_twin.ephemeris_loader --require-live
```

`GROUNDLINK_NORAD_ID` picks another satellite, `GROUNDLINK_OFFLINE=1` stays off the network
(the test suite runs this way, on the built-in element set), `GROUNDLINK_TLE_CACHE` moves the
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
  evaluate.py                   seeded evaluation: 8 attacks, 6 seeds, memory and timing
  api_gateway.py                FastAPI service
  dashboard_ui.py               Streamlit causal-chain inspector
tests/             139 tests
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

- **Live orbit**: the next real pass of TerraSAR-X (NORAD 31698, 514 km sun-synchronous) over
  the Zaghouan (Tunisia) ground station. `api/tle.ts` relays its latest element set from
  CelesTrak's public GP service, cached two hours at Vercel's edge as CelesTrak asks; the browser
  propagates it with SGP4 (satellite.js), picks the next pass that culminates at least 10° high
  and replays it, time-compressed, with its real elevation, range, Doppler and received power.
  Offline it flies the last element set the browser downloaded, and with none, the TerraSAR-X
  element set built into the site. The header, the orbit readout and the footer say which.
- **The fleet**: the satellite button in the header opens the whole signal database (167
  Earth-observation satellites) with the live sky over Zaghouan; click any satellite to fly it.
  `/?sat=<NORAD>` flies that satellite's next pass culminating at least 10° high,
  `/?sat=<NORAD>&from=<Unix ms>` the pass under way at that time (`dashboard/src/sim/fleet.ts`).
  Each satellite gets its own identity, emulated hardware token and Ed25519 key; TerraSAR-X and
  TanDEM-X are drawn to scale, the others as a generic Earth-observation bus.
- **3D ground link**: that pass over the station in real-time WebGL (ACES Filmic tone mapping,
  layered atmospheric scattering), with TerraSAR-X to scale: hexagonal body, body-mounted solar
  cells, radar antenna along a side facet, downlink antenna on its boom; the camera turned toward
  where the pass culminates. Click the satellite or the station to fly in and watch the signal live.
- **One continuous signal beam**: its colour and distortion, the Carrier Frequency (MHz) and carrier
  power (dBm) charts (Chart.js), the received spectrum, the security banner and the ledger all change
  together with the scenario.
- **Simulate attack**: Stealth Spoofing (forged MAC headers and nonces from node 0x99A2, power
  inside a ±4 dB band but 14σ below the link budget, quarantine protocols), Data Tampering (one payload bit flipped in transit: no RF signature,
  only hash verification sees it), Frequency Hijacking (rogue carrier +14.2 MHz, outside the 6 MHz channel, seen by the
  station's 40 MHz wideband spectrum monitor; carrier to ~8492 MHz, proof failures) and Noise
  Jamming (J/N +9.1 dB: 9.6 dB of SNR lost, carrier power estimate down to −96.5 dBm, fallback
  routing to GS-MAT).
  **Play demo** runs all four back to back.
- **The uplink**: the link runs both ways. Mission control at Zaghouan sends a telecommand about
  every second on the S-band uplink (2050 MHz, 50 dBW EIRP, its own Doppler and received power on
  board, through the twin's P.618 atmosphere at S-band), each sealed with HMAC-SHA256 under the
  uplink key; the spacecraft executes it only if the tag matches, compared in constant time, and
  its sequence count is newer than the last one executed (`dashboard/src/sim/uplink.ts`, a port
  of the twin's `run_uplink_command`). The **Uplink** side of the attack panel runs the twin's
  three uplink threats: Command Tampering (a command rewritten in flight to switch the
  transmitter off, original tag kept), Command Injection (forged from a rogue uplink in the Gulf
  of Gabès under a guessed key) and Command Replay (a genuine command recorded and sent again).
  The 3D view draws the uplink beam in orange and the rogue uplink in red; the ledger's
  **Uplink commands** view lists every command received on board and its verdict, with the count
  of hostile commands executed (always 0).
- **Packet inspection drawer**: every frame as it went through the three tiers: raw frame and
  payload hexdump (flipped bits highlighted); the data layer (`trust_anchor.py`: MAC received
  against MAC recomputed, nonce check, ledger block and `verify_chain()`); the physical layer
  (`security_detector.py`: range, Doppler, power and phase claimed against what SGP4 and the
  ITU-R P.618 link budget predict, each gap in sigma, the chi-square against its
  elevation-adaptive gate, the kinematic coupling of range and Doppler); the statistical layer
  (Isolation Forest score and confidence); and the decision of `physics_validator.py`
  (`ACCEPTED`, `HELD` or `REJECTED`) with its reasons.
- **Resilience & trust metrics**: authenticated, rejected, held and corrupted-to-analyst
  counts; live `verify_chain()` with a red-team "edit a past block" test; and per-scenario
  detection by tier (data, physical, statistical, stopped).
- **The signal database** (`/signal`): no fixed signal, and live. `/api/catalog` relays the latest
  element sets of CelesTrak's Earth-resources group (167 Earth-observation satellites, cached
  two hours at the edge; the last download, then a built-in snapshot, when CelesTrak is
  unreachable). The browser propagates each with SGP4 to its passes over Zaghouan in the next
  12 hours and turns every pass into the signal the station receives: rise and set above the
  2° mask, culmination, slant range, Doppler, received power and SNR through the X-band link
  budget and the ITU-R P.618 atmosphere (`dashboard/src/sim/signalDb.ts`), and the S-band
  uplink back to the satellite (Doppler and power received on board). The page re-propagates
  every second: a polar sky view of the satellites above Zaghouan now, the elevation, Doppler and
  power of each one in view, and a cursor moving along the selected pass's curves. Pick any of
  the ~380 signals to see it second by second and **fly it on the live testbed**; the TerraSAR-X
  pass the testbed replays by default is marked.
- **Hiding in the noise**, on its own pages linked from the top bar: `/attacks` (three ways an
  attacker imitates natural noise), `/protection` (an interactive stealth budget and the three
  tiers) and
  `/noise` (a narrated explainer video; source and re-render steps in `dashboard/explainer/`).
- **trust_anchor.py terminal**: live log of SHA-256 block validations from a genesis root hash,
  HMAC-SHA256 frame seals and Ed25519 signatures on every re-key, all computed with Web Crypto
  in the browser.
- **Detection**: the digital twin's three tiers, ported to the browser. Data layer: the trust
  anchor (HMAC-SHA256, anti-replay nonces, SHA-256 chain, cleared identity). Statistical layer:
  an Isolation Forest trained on nominal passes at load. Physical layer: the chi-square engine
  of `digital_twin/security_detector.py` on range, Doppler, power and carrier phase (4 degrees
  of freedom, 1e-4 false alarms, gate widened by 1 + 2 exp(−el/6°) near the horizon) plus the
  kinematic coupling of range and Doppler, against the live SGP4 pass and the twin's ITU-R
  P.618 atmosphere (`dashboard/src/data/p618.json`, written by `dashboard/scripts/gen-p618.py`
  and checked by `tests/test_digital_twin.py`). Either deterministic layer rejects a frame, the
  statistical layer alone holds it, and two tiers firing at once escalate the incident
  response. Every KPI tile is measured live in the browser.

The step-by-step evaluation walkthrough is in [docs/evaluation-guide.md](docs/evaluation-guide.md).

```bash
cd dashboard
npm install
npm run dev
```

Production deploys are triggered manually by the Vercel project owner; automatic Git deploys are
off in `vercel.json`.
