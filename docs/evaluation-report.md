# Evaluation & Performance Report

**Track 1:** Secure Ground-Link Testbed
**Phase 1 Submission – Anonymous Evaluation**

---

## 1. Executive Summary

This report gives the measured detection, false-alarm rate, processing time and memory of the
three-tier pipeline: the data tier (HMAC-SHA256, SHA-256 digest, anti-replay window), the
statistical tier (Isolation Forest) and the physical tier (chi-square against SGP4 and the
ITU-R P.618 link budget, plus the kinematic range–Doppler test), under the decision rule of the
live site: either deterministic tier rejects, the statistical tier alone holds, two tiers at once
quarantine. Telemetry comes from TerraSAR-X (≈514 km, sun-synchronous), downlinking at X-band
(8477.8 MHz) to the Zaghouan ground station in Tunisia, with eight attacks injected in bursts.

No attack packet reached the analyst in any run: all eight attacks were stopped from the first
packet of every burst. 0.7–1.5 % of genuine packets were held for review by the statistical tier
alone, and none was rejected. The chi-square engine raised 2 false alarms in 45,000 clean
packets, against 10⁻⁴ by design.

**Scope.** All traffic is synthetic; the orbits (CelesTrak element sets, SGP4) and the atmosphere
(ITU-R P.618-13) are real public models. These figures describe the testbed, not a real link,
and will be re-measured on the official reference datasets once they are released.

---

## 2. Quantitative Performance & Metrics

Six seeded runs of `python -m digital_twin.evaluate` (seeds 1–6), one packet a second while the
link is up. Each run trains the statistical tier on 3,000 nominal packets, then scores 6,000
held-out nominal packets interleaved with 400 attack bursts (8 attacks × 50 bursts × 30
packets), then 50 bursts of each of two below-the-gate jams and 150 telecommands under the
uplink threats.

*Stopped* means not delivered to the analyst: held, rejected or quarantined. The dashboard's live
tiles use the same definitions (detection rate = attack frames stopped; false-alarm rate =
genuine frames not delivered).

| Evaluation Metric | Target | Measured (6 seeds) | Status |
| :--- | :--- | :--- | :--- |
| **Attack packets stopped** | $100\%$ | $100\%$ of 12,000 per run, all eight attacks | ✅ Met |
| **Time to first stop** | first packet | packet 1 of every burst | ✅ Met |
| **False-alarm rate** (genuine packets not delivered) | $< 2.0\%$ | $0.7$–$1.5\%$, all held, none rejected | ✅ Met |
| **Chi-square false alarms** on clean packets | $10^{-4}$ by design | 2 in 45,000 ($4.4 \times 10^{-5}$) | ✅ Met |
| **Decision time per packet** (three tiers + rule) | $< 100\text{ ms}$ | $17\text{ ms}$ mean, $24\text{ ms}$ p95 | ✅ Met |
| **Ledger overhead** (authenticate + SHA-256 chain one block) | $< 10\text{ ms}$ | $0.016\text{ ms}$ mean, $\le 0.032\text{ ms}$ p95 | ✅ Met |
| **Ledger tamper test** (one verdict edited mid-chain) | detected | detected in every run | ✅ Met |
| **Uplink commands executed under attack** | 0 | 0 of 900 (tampering, injection, replay) | ✅ Met |
| **Memory, Python process** | report | 146 MB peak RSS (`getrusage`, numpy, scikit-learn, sgp4 included) | — |
| **Memory, browser** | report | 20.7 MB JS heap after 60 s of the live dashboard (Chromium, after GC) | — |

Times were measured on one core of an Intel Xeon @ 2.10 GHz (Python 3.11, scikit-learn 1.9.1).
Seeds 1–3 shared the CPU with a video render: 22 ms mean, 48 ms p95. The ledger figures come from
`testbed/trust_anchor.py` over 3,000 packets per seed. The browser heap was read with
`performance.memory` in headless Chromium at 1920×1080, sampled every 5 s for 60 s after a forced
garbage collection.

---

## 3. Adversarial Test Results

Share of packets flagged by each tier, and the outcome (range over the six seeds):

| Traffic | Data | Statistical | Physical | Delivered | Held | Rejected | Quarantined |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Genuine | 0% | 0.7–1.5% | 0% | 98.5–99.3% | 0.7–1.5% | 0% | 0% |
| Frequency Hijacking | 100% | 5.7–11.9% | 100% | 0% | 0% | 0% | 100% |
| Stealth Spoofing | 100% | 26.9–51.5% | 100% | 0% | 0% | 0% | 100% |
| Noise Jamming | 0% | 96.9–98.7% | 100% | 0% | 0% | 1.3–3.1% | 96.9–98.7% |
| Data Tampering | 100% | 0.7–1.8% | 0–0.1% | 0% | 0% | 98.2–99.3% | 0.7–1.8% |
| Replay | 98.1–100% | 0.5–2.4% | 100% | 0% | 0% | 0% | 100% |
| Relay | 0% | 100% | 100% | 0% | 0% | 0% | 100% |
| Delay | 0% | 5.3–12.7% | 100% | 0% | 0% | 87.3–94.7% | 5.3–12.7% |
| Injection | 100% | 1.1–2.2% | 0–0.1% | 0% | 0% | 97.8–98.9% | 1.1–2.2% |

1. **Frequency Hijacking (+14.2 MHz).** A louder rogue carrier 14.2 MHz above the 6 MHz channel,
   seen by the station's 40 MHz wideband spectrum monitor. No orbit produces that Doppler, so the
   physical tier fires; the rogue frames are sealed under the attacker's key, so the data tier
   fires too. Quarantined.
2. **Stealth Spoofing (node 0x99A2).** On the Doppler track and only 3.2 dB low: inside the old
   ±4 dB box gate, but 14σ off the link budget for the chi-square engine. Forged tags and reused
   sequence counts fail the data tier. Quarantined.
3. **Noise Jamming (J/N +9.1 dB).** The SNR falls 9.6 dB and the carrier power estimate collapses
   to −96.5 dBm. The frames are genuine, so the data tier accepts them; the physical tier rejects
   them and the statistical tier usually agrees. On the dashboard, fallback routing to GS-MAT.
4. **Data Tampering (one payload bit flipped in transit).** No RF signature: only the HMAC check
   sees it, on every frame. Rejected and retransmission requested; no re-key, since the relay
   never had the key.
5. **Replay (groundlink core).** Genuine frames recorded 1 to 3 minutes earlier, sent again with
   their recorded RF: the tag is valid, but the sequence count is stale and the Doppler belongs to
   another moment of the pass. Quarantined.
6. **Relay (the twin's meaconer).** Genuine frames forwarded over a 72.5 km longer path, 3 dB
   louder. Cryptography sees nothing; the range residual and the range–Doppler test do.
7. **Delay (groundlink core).** Genuine frames held back 80 ms: the timing says 24,000 km more
   range than the orbit allows. Rejected by the physical tier.
8. **Injection (the twin's CCSDS sequence hijack).** A forged SAFE_HOLD packet with recomputed CRC
   and SHA-256 and RF shaped like the satellite: only the HMAC check sees it, on every packet.

**Below the gate.** A jammer quieter than the stealth budget is harmless:

| Jam | SNR lost | Frames verifying | Physical tier flags | Delivered |
| :--- | ---: | ---: | ---: | ---: |
| J/N −12.8 dB (the dashboard's demo) | 0.22 dB | 100% | 0–0.1% | 96.2–98.4% |
| J/N −5.3 dB (the edge of the budget) | 1.12 dB | 100% | 34.7–37.1% | 50.3–56.8% |

At the edge of the budget the chi-square engine already catches a third of the packets on the
power residual; any louder and it fires on the power residual alone.

**Uplink.** Under command tampering, injection and replay, 0 of 900 hostile telecommands were
executed: the spacecraft checks each tag in constant time, then the sequence count.

The same scenarios run live in the web dashboard (`dashboard/`), where each attack also drives the
3D beams, the Carrier Frequency and Carrier Power charts and the `trust_anchor.py` log. The
dashboard runs browser ports of `trust_anchor.py` (same frame format, HMAC seal, replay window and
SHA-256 chain from the same genesis block; golden vectors are checked by both test suites), of
`detector.py` and of the chi-square engine.

---

## 4. Conclusion & Reproducibility

Each tier catches what the others miss: tampering and injection need the cryptography, relay,
delay and jamming need the physics, and the statistical tier corroborates without ever rejecting
alone. Below the stealth budget an attacker costs the link at most 1.1 dB and corrupts nothing.

Reproduce the six runs (about 10 minutes on 3 cores):

```bash
pip install -e ".[dev]"
python -m digital_twin.evaluate --seeds 1 2 3 4 5 6 --workers 3
```

`tests/test_digital_twin.py` runs the same evaluation on a smaller scale. The earlier box-gate
pipeline remains in `testbed/` (`python -m testbed.validator --seed 14`) for comparison.
