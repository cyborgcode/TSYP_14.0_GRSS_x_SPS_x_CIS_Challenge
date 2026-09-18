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
