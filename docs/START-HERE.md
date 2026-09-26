# Start here

Read this first if you're new to the project. It explains what we're building, what
already exists, how to run it, and what's left, in plain language. It takes about 15
minutes.

---

## 1. What we're building

We entered **TSYP14, Track 1: Secure Ground-Link Testbed**.

A satellite sends data down to a ground station by radio. That radio link is the
**ground link**. Someone with cheap radio equipment can interfere with it. Our job is to
**protect the data on that link and detect when someone is interfering**, then prove it
with numbers.

The competition cares most about **silent failure**. That's the case where the station
keeps working normally and never crashes, while it quietly accepts bad data. Nobody
notices until a wrong decision is made from that data.

---

## 2. The picture

```
   SATELLITE                                                  GROUND STATION
  ┌─────────┐        radio link  (the "ground link")        ┌──────────────┐
  │  sends  │ ─────────────────────────────────────────────►│   receives   │
  │ frames  │                     ▲                          │    frames    │
  └─────────┘                     │                          └──────────────┘
                           ┌──────┴──────┐
                           │  ATTACKER   │  can: change, forge, replay,
                           │  with radio │       forward, delay, or jam
                           └─────────────┘
```

A **frame** is one small packet of satellite data, like one message. The satellite sends
10 frames every second.

---

## 3. Our answer: two locks

Think of the satellite as mailing letters.

**Lock 1: a tamper-proof seal (cryptography).**
Every letter is sealed. If anyone opens it, changes a single letter of it, or writes a fake
one, the seal breaks and we throw it away. Each letter also carries a number, and we refuse
any number we've already seen, so old letters can't be re-sent.
This uses **AES-256-GCM**, the same kind of encryption used for real space links.

**Lock 2: checking how the letter arrived (machine learning).**
Here's the catch. A thief can take a *genuine, sealed* letter and:
- deliver it himself, from his own truck (**relay**)
- hold it and deliver it late (**delay**)
- block the road so letters don't arrive at all (**jamming**)

The seal is never broken, so Lock 1 sees nothing wrong.

We know exactly where the satellite is at every moment from its orbit. So we know **when**
each frame should arrive, **how strong** the signal should be, and what **Doppler shift**
it should have (the frequency change from the satellite moving, like a passing siren).
Lock 2 compares every frame against that prediction. A trained detector flags anything
that doesn't fit.

**Neither lock is enough alone. Together they catch everything we test.** That's the core
idea of our entry.

---

## 4. The six attacks we test

| Attack | In plain words | Lock 1 (crypto) | Lock 2 (ML) |
| --- | --- | --- | --- |
| **Tamper** | Change bytes inside a frame | ✅ catches | ❌ can't see it, the physics looks normal |
| **Inject** | Send fake frames | ✅ catches | ✅ catches, fake has wrong Doppler |
| **Replay** | Re-send old genuine frames | ✅ catches, old number | ✅ catches, wrong timing |
| **Relay** | Forward genuine frames through own radio | ❌ frames are genuine | ✅ catches, extra delay and wrong power |
| **Delay** | Hold genuine frames, release late | ❌ frames are genuine | ✅ catches, arrives late |
| **Jamming** | Flood the radio with noise | ❌ survivors are genuine | ✅ catches, signal quality collapses |

---

## 5. What's in the repository

```
groundlink/          ← all the Python code
  frames.py            what a frame looks like (its header)
  security.py          LOCK 1: seal, verify, reject replays
  channel.py           the satellite's orbit: where it is, what signal to expect
  simulate.py          creates realistic fake traffic for one satellite pass
  attacks.py           the six attacks
  station.py           the ground station: runs both locks on every frame
  detector.py          LOCK 2: the machine-learning detector
  audit.py             a tamper-proof logbook of everything the station received
  evaluate.py          scoring: how much we catch, how often we're wrong
  cli.py               runs the whole scenario with one command

tests/               ← 58 automatic checks that the code does what it says
docs/                ← one document per competition deliverable (see section 8)
dashboard/           ← web page for the Phase 2 live demo (placeholder for now)
data/                ← where the official competition datasets will go
```

---

## 6. Run it yourself

You need Python 3.11 or newer. From the repository folder:

```bash
python -m venv .venv
```

```bash
source .venv/bin/activate
```

On Windows, use `.venv\Scripts\activate` instead.

```bash
pip install -e ".[dev]"
```

```bash
python -m groundlink.cli
```

That simulates a full satellite pass, attacks it six different ways, and prints the
results. To check nothing is broken:

```bash
python -m pytest
```

---

## 7. Reading the output

```
attack    crypto Pd   ML Pd  both Pd  both Pfa  ML AUC  caught by  driver
tamper        1.000   0.000    1.000     0.012   0.507  crypto     —
relay         0.000   1.000    1.000     0.012   1.000  ml         latency_residual_ms
```

| Column | Meaning |
| --- | --- |
| **Pd** | *Probability of detection*: share of attacked frames we caught. 1.000 = all of them |
| **Pfa** | *Probability of false alarm*: share of normal frames we wrongly flagged. 0.012 = 1.2% |
| **crypto / ML / both** | Lock 1 alone, Lock 2 alone, either one |
| **ML AUC** | How well Lock 2 separates attacked from normal. 1.0 = perfect, 0.5 = coin flip |
| **caught by** | Which lock did the work |
| **driver** | Which measurement gave the attack away |

Read the **tamper** row: the ML score is 0.507, a coin flip. That's expected, because
changing bytes doesn't change the physics. Read the **relay** row: crypto catches nothing,
because the frames are genuine. That's the whole argument for having two locks.

Below the table you'll also see the **cost**: 16 extra bytes per frame for the seal, and a
few microseconds of computing per frame.

---

## 8. How the work maps to the competition

The judges score six deliverables. Each one has its own document in `docs/`:

| # | Deliverable | Points | Status |
| --- | --- | --- | --- |
| 1 | [Threat Model & Segment Analysis](1-threat-model.md) | 15 | Drafted |
| 2 | [Platform / Architecture & Trust Anchor](2-architecture-trust-anchor.md) | 15 | Built |
| 3 | [Signal / Image Processing](3-signal-processing.md) | 15 | Built |
| 4 | [AI or Statistical Detection](4-detection.md) | 20 | Built |
| 5 | [Adversarial Validation & Response](5-adversarial-validation.md) | 20 | **Half done** |
| 6 | [Documentation & Official Datasets](6-datasets-reproducibility.md) | 5–10 | **Blocked** |

---

## 9. What is NOT done, and matters most

**1. We're not using real data yet.** Everything runs on *simulated* satellite traffic.
The competition requires their **official datasets**. The perfect scores above prove the
system works end to end, but **they can't be submitted as results**. Getting the datasets
is the most urgent task on the team, because it blocks deliverables 3–6.

**2. We haven't tested a clever attacker.** All attacks currently run at full strength,
which is why we catch 100%. Deliverable 5 (20 points) means turning each attack down
(shorter delays, better-disguised relays, weaker jamming) until we *stop* catching it, and
reporting where that line is. See [5-adversarial-validation.md](5-adversarial-validation.md)
for the exact plan.

**3. The scope needs confirming.** "Ground link" could also mean the navigation/timing
signals a station uses. We've focused on the satellite ↔ station data link. Someone should
confirm with the organisers (ghassen.ltaif@ieee.org).

---

## 10. What changed, if you saw an earlier version

An earlier version of this repo watched the ground station's **navigation signals**
(GPS-style). It was removed. The project now protects the **data link between satellite
and station**, which matches how the team reads Track 1. The tamper-proof logbook and the
scoring code were kept; everything else is new. The reasoning is recorded in
[decisions.md](decisions.md).

---

## 11. Your next step

1. Run it (section 6) and look at the output yourself.
2. Read the deliverable document for the area you'll own.
3. Put your name against a role in [CONTRIBUTING.md](../CONTRIBUTING.md). There are five
   roles, one per person.
4. Read [roadmap.md](roadmap.md) for the dates. **Phase 1 is due 8 November 2026.**
5. Read "How we meet" in [CONTRIBUTING.md](../CONTRIBUTING.md): Monday planning, daily
   written stand-up, Friday demo.

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Frame** | One packet of data from the satellite |
| **Ground link** | The radio connection between satellite and ground station |
| **AES-256-GCM** | Encryption that both hides data and seals it so any change is detected |
| **Authentication tag** | The 16-byte "seal" on each frame; breaks if anything changes |
| **Replay** | Re-sending an old genuine message to trick the receiver |
| **Man in the middle** | An attacker sitting between sender and receiver |
| **Doppler shift** | Change in signal frequency because the satellite is moving |
| **RSSI** | Received signal strength: how loud the signal is |
| **SNR** | Signal-to-noise ratio: how clear the signal is above background noise |
| **Residual** | Measured value minus predicted value; near zero means normal |
| **Isolation Forest** | An ML method that finds unusual data points by how easily they can be separated from the rest |
| **Trained on clean data** | The detector only ever sees normal traffic while learning, so it learns "normal" and flags anything else |
| **Pd / Pfa** | Detection rate / false-alarm rate |
| **ROC AUC** | One number for how well a detector separates attack from normal (0.5 = guessing, 1.0 = perfect) |
| **Trust anchor** | The thing the whole security rests on; for us, the secret key and the sealing |
