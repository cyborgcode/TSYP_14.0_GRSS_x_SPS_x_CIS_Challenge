# Roadmap to Phase 1

Deadline **8 November 2026**. Phase 1 is worth 30% of the final score; Phase 2 is 70%.

## Deliverable status

| # | Deliverable | Points | Status |
| --- | --- | --- | --- |
| 1 | Threat model & segment analysis | 15 | Drafted — `docs/threat-model.md` |
| 2 | Platform / architecture / trust anchor | 15 | Implemented — `core/trust.py`, `docs/architecture.md` |
| 3 | Signal / image processing | 15 | Baseline features implemented — `core/features.py` |
| 4 | AI or statistical detection | 20 | Statistical detector implemented — `core/detectors.py` |
| 5 | Adversarial validation & response | 20 | **Not started** — evasion sweep required |
| 6 | Documentation on official reference datasets | 5 (+10 feasibility) | **Blocked** — datasets not yet obtained |

## Critical path

1. **Obtain the official reference datasets.** Everything currently runs on synthetic
   observables. Results on synthetic data cannot be reported as results. This blocks
   deliverable 6 and weakens 3–5. Record each dataset in `data/README.md`.
2. **Adversarial validation (20 points).** Sweep attack strength downward until detection
   fails, and report the detectability floor per attack. An adversary who has read our
   detector is explicitly in the threat model, so the evasion case must be measured, not
   asserted.
3. **Replace synthetic generation with dataset replay** behind the same `Observables`
   interface, so the detector and harness carry over unchanged.
4. **Harden the trust anchor** — move the key out of the source, document key handling.
5. **Anonymity pass before submission.** No names, unit names, logos or identifying
   repository metadata. Commit authorship is already neutral; re-check before packaging.

## Parallel work split (5 members max)

| Owner | Scope |
| --- | --- |
| _tbd_ | Datasets + replay adapter (blocks everyone, start first) |
| _tbd_ | Threat model + report writing |
| _tbd_ | Features and signal processing |
| _tbd_ | Detector + evaluation |
| _tbd_ | Adversarial validation + dashboard demo |

## Phase 2 (11 December 2026)

Finalists present a 7-minute live or replayable attack demonstration plus 3 minutes of Q&A.
The `dashboard/` app is that demonstration surface: replay a sealed record, inject an attack
live, show the detector firing and the chain verification failing on a tampered log.
