# Architecture and trust anchor

> Deliverable 2 of 6. Phase 1 weight: 15 / 100.

## Pipeline

```
RF front-end
    │  per-epoch observables (C/N0, AGC, pseudorange residual, clock bias)
    ▼
core.observables ──► core.trust  (seal: HMAC-SHA256 hash chain)
    │                     │
    │                     └──► sealed observation log ──► verification at any later point
    ▼
core.features  (6 interpretable features per epoch)
    ▼
core.detectors (robust baseline → max-|z| → CUSUM with restart)
    ▼
core.evaluate  (Pd, Pfa, latency, ROC AUC)
    ▼
dashboard/     (replay + live demo surface for Phase 2)
```

## Trust anchor

The challenge accepts a software or emulated anchor, so the anchor is HMAC-SHA256 over a
hash chain, standard library only:

- Each epoch is canonicalised (sorted-key JSON) and hashed.
- Each record commits to the previous record's MAC, so the log is append-only in effect.
- `verify()` rejects an edited payload, a reordered pair, a dropped record and a truncated
  tail, naming the first failing index.

This gives **integrity and ordering** of the observation record. It does not give
confidentiality, and it does not prove the RF signal itself was authentic — that is the
detector's job. The two are complementary: the detector says *this epoch looks attacked*,
the anchor says *this is the epoch that was actually recorded, unaltered*.

Key handling is the known weak point: the development key is a literal in `core.cli`. Before
submission it must come from the environment, and the threat model already scopes key
compromise as out of scope for the adversary.

## Detector design

| Stage | Purpose |
| --- | --- |
| Robust baseline (median / MAD) | Fit the quiet period without letting a short attack inside the window widen the scale |
| Max-\|z\| across features | Instantaneous, attributable — the alarm names the driving feature |
| CUSUM with restart | Catches slow-onset attacks; restarting after each declaration stops alarms persisting once the attack ends |
| Calibrated operating point | Drift and threshold are set from the clean prefix against a stated target false-alarm rate |

Calibrating rather than hand-tuning the threshold is what makes the reported Pfa meaningful
and the run reproducible.

## Local execution

No purchase, no hardware, no network: `pip install -e .[dev]` then `python -m core.cli`.
Runtime is well under a second for a 600-epoch record on a laptop.
