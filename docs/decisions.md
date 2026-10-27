# Decision log

One entry per decision that would be expensive to revisit. Append, never edit — if a
decision is reversed, add a new entry that supersedes the old one.

Format: date, decision, why, what it rules out.

---

## 2026-09-18 — Track 1: Secure Ground-Link Testbed

**Decision.** The team enters Track 1 of the three available.

**Why.** The ground link is the segment where an attack is both realisable with commodity
hardware and detectable from observables a receiver already produces, so the full chain —
threat model, trust anchor, processing, detection, adversarial validation — fits in one
laptop-executable prototype.

**Rules out.** Tracks 2 and 3. The rules allow exactly one track; this cannot be revisited
without restarting the technical work.

---

## 2026-09-18 — Software trust anchor over hardware

**Decision.** Integrity is provided by an HMAC-SHA256 hash chain over per-epoch observables,
Python standard library only.

**Why.** The challenge explicitly accepts a software or emulated trust anchor, and no
purchase is required. A stdlib implementation reproduces on any laptop, which serves the
feasibility and reproducibility criteria directly.

**Rules out.** TPM or secure-element dependencies. Confidentiality is out of scope — the
anchor proves integrity and ordering, not secrecy. Key compromise is out of the adversary
model.

---

## 2026-09-18 — Calibrated operating point rather than a tuned threshold

**Decision.** The detector's CUSUM drift and alarm threshold are derived from the clean
prefix against a stated target false-alarm rate.

**Why.** A hand-tuned threshold makes a reported false-alarm rate meaningless and is not
reproducible. Tie-breaks in this challenge are decided on the lower false-alarm rate, so the
operating point has to be stated and defensible.

**Rules out.** Reporting any Pd without the Pfa it was measured at.

---

## 2026-09-26 — Defend the satellite-to-station data link, not navigation signals

**Supersedes** the navigation-signal scope implied by the first Track 1 prototype.

**Decision.** The ground-link segment we defend is the downlink carrying telemetry from
spacecraft to station. The first prototype watched the station's navigation receiver; that
code is removed.

**Why.** The team's reading of the track is that the data moving between satellite and
station must be protected and tampering by a man in the middle detected. The satellite ↔
station link is the core of "ground link", and it gives the clearest demonstration of the
challenge's silent-failure problem.

**Rules out.** Navigation-signal spoofing as the primary scenario. Scope is still to be
confirmed with the organisers; if they expect navigation signals too, the station's
feature layer is where it would attach.

---

## 2026-09-26 — Two independent defensive layers

**Decision.** Cryptography (AES-256-GCM with anti-replay) and link-behaviour anomaly
detection run side by side and are evaluated separately.

**Why.** Measured, not assumed: relay, delay and jamming deliver genuine frames and pass
every cryptographic check; tampering changes bytes but not physics and is invisible to the
detector (ROC AUC 0.512). Neither layer covers the catalogue alone.

**Rules out.** Presenting either layer as sufficient on its own.

---

## 2026-09-26 — Hybrid detector over Isolation Forest alone

**Decision.** The detector merges an Isolation Forest with a robust per-feature gate, each
normalised on a clean calibration pass.

**Why.** Isolation Forest alone caught the delay attack on 28% of frames: a value beyond the
training range is isolated no faster than the most extreme training point, so single-feature
deviations saturate. The hybrid catches it on 100% at the same false-alarm rate.

**Rules out.** Reporting Isolation Forest results without the gate, or vice versa, as the
headline detector.

---

## 2026-09-26 — Correction: Isolation Forest delay figure

**Corrects** the "28% of frames" figure in the hybrid-detector entry above, which came from a
single training run.

Re-measured across 10 independent training and calibration seeds on the same attacked pass,
Isolation Forest alone catches the delay attack on **17–35% of frames (median 26%)**. The
hybrid detector catches 100% on all 10 seeds. The decision stands; the figure was
seed-dependent and is now reported as a range.

**Rule going forward.** Detector figures in the report come from multiple seeds and are
stated as a range or with a spread, never from one run.
