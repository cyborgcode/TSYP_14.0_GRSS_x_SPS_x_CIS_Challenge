# Evaluation & Performance Report

**Track 1:** Secure Ground-Link Testbed
**Phase 1 Submission – Anonymous Evaluation**

---

## 1. Executive Summary

This report gives the measured detection, false-alarm rate, processing time and memory of the
three-tier pipeline under the decision rule of `digital_twin/decision.py`, which the live site
runs too: the data tier (decoder, HMAC-SHA256, SHA-256 digest, anti-replay window), the
statistical tier (the site's per-frame Isolation Forest) and the physical tier (chi-square against
SGP4 and the ITU-R P.618 link budget, plus the kinematic range–Doppler test). Five outcomes:
delivered, degraded (genuine frame, only its power anomalous, delivered flagged with a jamming
alarm), held, rejected, quarantined (two tiers, or 3 authentication failures within 10 frames).
Telemetry comes from TerraSAR-X (≈514 km, sun-synchronous), downlinking at X-band (8477.8 MHz) to
the Zaghouan ground station in Tunisia, with ten attacks injected in bursts.

Every one of the 90,000 attack packets was flagged, from the first packet of every burst, and
none reached the analyst unflagged (≤ 4.3 × 10⁻⁵ at 95 %). 98.8 % of the 46,800 held-out genuine
packets were delivered clean; 1.14 % were held for review by the statistical tier alone.

**Scope.** The official reference datasets were not published by the organisers as of
2 November 2026. The evaluation reads every packet through one adapter
(`digital_twin/datasets.py`): `--dataset official --path` scores the official set with no code
change. Real data today: the CelesTrak orbits and the ITU-R P.618-13 atmosphere. Synthetic: the
frame payloads and the RF measurements. These figures describe the testbed, not a real link.

---

## 2. Quantitative Performance & Metrics

Six seeded runs of `python -m digital_twin.evaluate` (seeds 1–6), one packet a second while the
link is up (the live demo sends 3.1 a second; one a second keeps six runs within a laptop's CPU
budget). Each run trains the statistical tier on 3,000 nominal packets, then scores 7,800
held-out nominal packets interleaved with 500 attack bursts (10 attacks × 50 bursts × 30
packets) and 150 bursts of three below-the-gate jams, then 150 telecommands under the uplink
threats. Rates are pooled over the six runs, with 95 % Wilson intervals.

| Evaluation Metric | Target | Measured (6 seeds) | Status |
| :--- | :--- | :--- | :--- |
| **Attack packets flagged** (not delivered clean) | $100\%$ | 90,000 of 90,000; unflagged $\le 4.3 \times 10^{-5}$ at 95 % | ✅ Met |
| **Time to first flag** | first packet | packet 1 of every burst, all ten attacks | ✅ Met |
| **Genuine packets not delivered** | $< 2.0\%$ | 544 of 46,800 = 1.16 % [1.07, 1.26]: 533 held, 10 rejected, 1 quarantined | ✅ Met |
| **Genuine packets delivered degraded** | report | 5 of 46,800 ($1.1 \times 10^{-4}$) | — |
| **Chi-square fired on held-out genuine packets** | $10^{-4}$ by design | 8 of 46,800 = $1.7 \times 10^{-4}$ [$0.9$, $3.4$] $\times 10^{-4}$ | ✅ Consistent |
| **Decision time per packet** (three tiers + rule) | $< 100\text{ ms}$ | $15.3$–$15.8\text{ ms}$ mean, $\le 22.6\text{ ms}$ p95 | ✅ Met |
| **Ledger overhead** (authenticate + SHA-256 chain one block) | $< 10\text{ ms}$ | $0.016\text{ ms}$ mean, $\le 0.032\text{ ms}$ p95 | ✅ Met |
| **Ledger tamper test** (one verdict edited mid-chain) | detected | detected in every run | ✅ Met |
| **Uplink commands executed under attack** | 0 | 0 of 900 ($\le 4.3 \times 10^{-3}$ at 95 %) | ✅ Met |
| **Memory, Python process** | report | 151 MB peak RSS (`getrusage`, numpy, scikit-learn, sgp4 included) | — |
| **Memory, browser** | report | 20.7 MB JS heap after 60 s of the live dashboard (Chromium, after GC) | — |

The 46,800 genuine packets are the held-out nominal packets only (7,800 per run); the 3,000
training packets per run are not counted. The 16 physical flags on genuine packets (8 chi-square,
9 kinematic, one packet both) became 5 degraded deliveries, 10 rejections and 1 quarantine. Times were measured on one core of an Intel Xeon @ 2.10 GHz (Python 3.11, scikit-learn
1.9.1). The ledger figures come from `testbed/trust_anchor.py` over 3,000 packets per seed.

---

## 3. Adversarial Test Results

Share of packets flagged by each tier, and the outcome (range over the six seeds):

| Traffic | Data | Statistical | Physical | Delivered | Degraded | Held | Rejected | Quarantined |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Genuine | 0% | 1.0–1.4% | 0–0.1% | 98.6–99.0% | 0% | 1.0–1.4% | 0–0.1% | 0% |
| Frequency hijacking | 100% | 100% | 100% | 0% | 0% | 0% | 0% | 100% |
| Stealth spoofing | 100% | 85.6–100% | 100% | 0% | 0% | 0% | 0% | 100% |
| Noise jamming | 30.0–31.0% | 71.0–100% | 100% | 0% | 68.3–69.3% | 0% | 0% | 30.7–31.7% |
| Data tampering | 100% | 0.8–1.3% | 0–0.1% | 0% | 0% | 0% | 6.5–6.7% | 93.3–93.5% |
| Relay (meaconing) | 0% | 44.5–100% | 100% | 0% | 0% | 0% | 0–55.5% | 44.5–100% |
| Phase slip (held out) | 0% | 10.9–24.1% | 100% | 0% | 0% | 0% | 75.9–89.1% | 10.9–24.1% |
| Injection | 100% | 0.9–1.7% | 0–0.1% | 0% | 0% | 0% | 6.5–6.7% | 93.3–93.5% |
| Replay | 100% | 97.3–100% | 100% | 0% | 0% | 0% | 0% | 100% |
| Delay | 0% | 0.7–1.3% | 100% | 0% | 0% | 0% | 98.7–99.3% | 0.7–1.3% |
| Co-channel capture (held out) | 100% | 100% | 100% | 0% | 0% | 0% | 0% | 100% |

Where each attack comes from: the four of the live dashboard (`dashboard/src/sim/signals.ts`,
with its constants); relay, phase slip and injection are the twin's `DELAY_SPOOFING_MEACONING`,
`COHERENT_PHASE_SLIP` and `CCSDS_SEQUENCE_HIJACK` (`attack_injector.py`); replay and delay are
`groundlink/attacks.py`'s; the co-channel capture is a louder transmitter 4 kHz off the Doppler
track on the channel itself. Phase slip and co-channel capture were added after the gates and
the rule were fixed and are reported as held-out attacks; every gate is set from clean traffic.

1. **Frequency hijacking (+14.2 MHz).** A sanity check: only a station whose wideband monitor
   re-tunes to the rogue carrier is exposed. No orbit produces that Doppler and the frames are
   sealed under the attacker's key. Quarantined. The co-channel capture is the realistic case.
2. **Stealth spoofing (node 0x99A2).** On the Doppler track and only 3.2 dB low: inside the old
   ±4 dB box gate, but 14σ off the link budget. Forged tags and reused counts. Quarantined.
3. **Noise jamming (J/N +9.1 dB).** The SNR falls 9.6 dB: below the decoder's 4.4 dB threshold
   (CCSDS rate-1/2 code, `fec.py`) the frames are lost, 30 % of them, on the low-elevation part
   of each pass;
   the others decode bit-exact, verify, and reach the analyst flagged as degraded with a
   jamming alarm. On the dashboard, quarantine of GS-ZAG triggers fallback routing to GS-MAT,
   2.8 s after the jam starts.
4. **Data tampering.** No RF signature: only the HMAC check sees it. The first two frames of a
   burst are rejected and resent; the third failure within 10 frames quarantines the link. No
   re-key, since the relay never had the key.
5. **Replay.** Genuine frames recorded 1 to 3 minutes earlier: the count is stale for the data
   tier on every frame, now that every count that authenticates is marked as seen (before, a
   genuine frame the forest held left its count unmarked, and up to 1.9 % of replays passed the
   data tier), and the Doppler belongs to another moment of the pass. Quarantined.
6. **Relay, delay, phase slip.** Genuine frames: cryptography sees nothing; the range residual,
   the range–Doppler test, the timing and the phase residual do.
7. **Injection (CCSDS sequence hijack).** A forged SAFE_HOLD packet with recomputed CRC and
   SHA-256: only the HMAC check sees it. Reject, reject, then quarantine.

**Below the gate.** The stealth budget depends on elevation, because the chi-square gate widens
near the horizon: a jammer stays hidden while it costs less than √(23.5 · w(el)) × 0.23 dB of SNR.

| Elevation | Gate widening w(el) | Widened gate | Power-only allowance | Largest hidden J/N |
| :--- | ---: | ---: | ---: | ---: |
| 2° (mask) | 2.43 | 57.2 | 1.74 dB | −3.1 dB |
| 9° | 1.45 | 34.0 | 1.34 dB | −4.4 dB |
| 30° | 1.01 | 23.8 | 1.12 dB | −5.3 dB |
| 90° | 1.00 | 23.5 | 1.12 dB | −5.3 dB |

| Jam | SNR lost | Frames verifying | Physical flags | Reaching the analyst (clean + degraded) |
| :--- | ---: | ---: | ---: | ---: |
| J/N −12.8 dB (the dashboard's demo) | 0.22 dB | 100% | 0–0.1% | 98.9% |
| J/N −5.3 dB (the budget overhead) | 1.12 dB | 100% | 35.4–38.5% | 95.3% |
| J/N −3.1 dB (the budget at the mask) | 1.73 dB | 100% | 89.1–90.5% | 95.8% |

Below about J/N −12 dB a jammer costs under 0.3 dB of SNR and changes nothing. At the edge of
the budget it is caught on about one frame in three; those frames reach the analyst flagged as
degraded, since their HMAC still proves their origin. What does not reach the analyst is held by
the statistical tier alone (3.5–5.9 % at −5.3 dB).

**Ablation.** Share of attack packets that would reach the analyst unflagged with one tier
removed (pooled):

| Attack | Without the data tier | Without the statistical tier | Without the physical tier |
| :--- | ---: | ---: | ---: |
| Data tampering | 98.8% | 0% | 0% |
| Injection | 98.8% | 0% | 0% |
| Delay | 0% | 0% | 99.0% |
| Phase slip | 0% | 0% | 83.0% |
| Noise jamming | 0% | 0% | 12.1% |
| Relay | 0% | 0% | 9.5% |
| The four others | 0% | 0% | 0% |

No single tier is enough: without the data tier tampering and injection pass, without the
physical tier delay and phase slip pass. Removing the statistical tier lets nothing through in
these runs: it corroborates, it is never the only tier to see an attack.

**Detection curves.** Area under the ROC curve, attack packets against clean ones (mean over the
seeds): the chi-square score reaches 1.000 on every RF attack (hijacking, spoofing, jamming,
relay, phase slip, replay, delay, capture) and the forest 0.994–1.000 on all but phase slip
(0.858) and delay (0.503). Both are at chance (0.50) on tampering and injection, which leave no
RF trace: only the HMAC sees them.

**Tier correlation.** On the 46,800 genuine packets the statistical tier flagged 537, the
physical tier 16 and both 4: φ = 0.04, close to independent. Under attack they agree more,
because the per-frame forest reads the carrier and power residuals the chi-square also uses;
quarantine therefore always needs at least one deterministic tier.

**Uplink.** Under command tampering, injection and replay, 0 of 900 hostile telecommands were
executed: the spacecraft checks each tag in constant time, then the sequence count.

---

## 4. Conclusion & Reproducibility

Each tier catches what the others miss: tampering and injection need the cryptography, delay
and phase slip the physics, and the statistical tier corroborates without ever rejecting alone.
Below the stealth budget an attacker costs the link at most 1.1 dB overhead, 1.7 dB at the mask,
and corrupts nothing; above it, genuine frames still reach the analyst, flagged.

Reproduce the six runs (about 15 minutes on 3 cores):

```bash
pip install -e ".[dev]"
python -m digital_twin.evaluate --seeds 1 2 3 4 5 6 --workers 3
python -m digital_twin.evaluate --dataset official --path data/official.jsonl   # when released
```

`tests/test_digital_twin.py` runs the same evaluation on a smaller scale, exports it through the
dataset adapter and reads it back to the same decisions. The browser and the Python testbed share
golden vectors for the frame format, the HMAC-SHA256 tag, the SHA-256 frame digest and the ledger's
genesis root, and the chi-square constants (gate, widening, kinematic gate); the groundlink core's
AES-256-GCM seal is its own. The earlier box-gate pipeline remains in `testbed/`
(`python -m testbed.validator --seed 14`) for comparison.
