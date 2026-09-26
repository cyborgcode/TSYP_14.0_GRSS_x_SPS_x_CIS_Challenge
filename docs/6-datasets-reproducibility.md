# 6 · Documentation & Official Datasets

> Clarity & reproducibility: **5 points** · Feasibility, affordability & local execution: **10 points**

## Status: blocked on the official datasets

The challenge requires the official reference datasets for the standard evaluation
scenario. Until they are in hand, `groundlink/simulate.py` generates traffic so the full
pipeline can be built and tested. **Synthetic results are not reportable results.**

When a dataset arrives, log it in `data/README.md` and write a replay adapter that produces
`Reception` objects (`groundlink/simulate.py`). Nothing downstream — station, detector,
scoring — needs to change.

## Reproducibility

Every reported number must come from a command in this repository, never pasted by hand.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
python -m pytest
python -m groundlink.cli
```

- Fixed seeds give identical traffic and identical metrics on every run.
- Results do not depend on the key value; set `GROUNDLINK_KEY` for a fixed key anyway.
- CI runs the tests and the full standard scenario on every push.

## Feasibility & affordability

| Requirement | How it is met |
| --- | --- |
| No purchase required | Software trust anchor; no hardware, no SDR needed to run |
| Local laptop execution | Full scenario runs in seconds on one core |
| Open dependencies | numpy, scikit-learn, cryptography — all open source, pip-installable |
| No network | Nothing is downloaded at run time |

## Anonymity checklist (before Phase 1 submission)

- [ ] No names, unit names or logos in code, docs, report or figures
- [ ] Commit authorship neutral on every commit
- [ ] Repository name and URL neutral
- [ ] Report file metadata (author, company) stripped
- [ ] Screenshots free of usernames, paths and browser profiles
