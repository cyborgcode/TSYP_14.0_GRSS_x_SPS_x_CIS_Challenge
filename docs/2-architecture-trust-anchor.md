# 2 · Platform / Architecture & Trust Anchor

> Phase 1 weight: **15 points**

## Pipeline

```
SPACECRAFT                          RF PATH                         GROUND STATION
──────────                          ───────                         ──────────────
telemetry ─► LinkProtector ─► frame ─────► (attacker?) ─────► reception
             AES-256-GCM                                          │
             seq-counter nonce                                    ├─► Layer 1: LinkVerifier
             header as AAD                                        │     auth · decrypt · anti-replay · freshness
                                                                  │
                                                                  ├─► Layer 2: features vs orbit prediction
                                                                  │     → LinkAnomalyDetector
                                                                  │
                                                                  └─► ObservationLog (HMAC hash chain)
                                                                        tamper-evident reception history
```

| Module | Role |
| --- | --- |
| `groundlink/frames.py` | 19-byte header: spacecraft id, virtual channel, sequence, timestamp |
| `groundlink/security.py` | `LinkProtector` (spacecraft) and `LinkVerifier` (station) |
| `groundlink/channel.py` | Orbit geometry: range, light time, Doppler, received power |
| `groundlink/simulate.py` | Clean traffic for one pass |
| `groundlink/attacks.py` | Six attacks, each with ground-truth labels |
| `groundlink/station.py` | Runs both layers per frame, extracts features |
| `groundlink/detector.py` | Hybrid anomaly detector |
| `groundlink/audit.py` | Tamper-evident station log |
| `groundlink/evaluate.py` | ROC AUC, detection latency |
| `groundlink/cli.py` | Standard scenario runner |

## Trust anchor

The challenge accepts a software or emulated trust anchor. Ours has two parts:

**In flight — AES-256-GCM authenticated encryption**, the same primitive family used by
CCSDS Space Data Link Security:
- Payload encrypted; header in the clear but bound into the tag as associated data, so
  editing either breaks authentication.
- 96-bit nonce derived from a 64-bit sequence counter, so it never repeats under one key.
- Receiver rejects any sequence number at or below the highest accepted one (anti-replay),
  and any frame whose authenticated timestamp is more than `max_age_s` from arrival.
- A rejected frame never advances the replay window.

**At rest — HMAC-SHA256 hash-chained reception log.** Each station report commits to the
previous record, so any later edit, reorder or deletion is detected and located by index.

**Key handling.** The link key is read from `GROUNDLINK_KEY` (64 hex characters). Without
it a fresh random key is drawn per run. No key is stored in the repository.

## Why not cryptography alone

See the threat model: relay, delay and jamming deliver valid frames. The trust anchor
guarantees *content*; only the second layer can speak to *path*.
