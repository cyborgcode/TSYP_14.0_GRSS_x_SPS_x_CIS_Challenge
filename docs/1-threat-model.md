# 1 · Threat Model & Segment Analysis

> Phase 1 weight: **15 points**

## Segment

The **ground link**: the radio path that carries telemetry from the spacecraft down to the
ground station. Every downstream Earth-observation product inherits whatever this link
delivers, so a corrupted frame that is accepted here is trusted by everything after it.

## Assets

| Asset | Property to protect | Consequence of loss |
| --- | --- | --- |
| Telemetry frames in flight | Integrity, authenticity, freshness | Wrong data accepted as genuine |
| Frame ordering | No replay, no reorder | Old state presented as current |
| Link availability | Frames arrive at all | Silent gaps in the record |
| Station's reception log | Tamper-evident history | Provenance cannot be proven after the fact |

## Adversary

- **Capability:** a ground transmitter or relay within radio range of the station, built
  from commodity software-defined radio. Can receive, record, block, delay, forward and
  transmit on the downlink frequency.
- **Knowledge:** the frame format, the public orbit (ephemeris), and our detector's design.
- **Does not have:** the link key. Key compromise is out of scope; see residual risk.
- **Goal:** get the station to accept false or stale data, or lose data, without an alarm.

## Attack catalogue

| # | Attack | What the attacker does | Frames still cryptographically valid? | Implemented |
| --- | --- | --- | --- | --- |
| A1 | **Tamper** | Man-in-the-middle alters frame bytes | No | `attacks.tamper` |
| A2 | **Inject** | Forges frames without the key | No | `attacks.inject` |
| A3 | **Replay** | Retransmits genuine frames recorded earlier | Yes (tag) — but stale / old counter | `attacks.replay` |
| A4 | **Relay** | Forwards genuine frames unchanged via its own transmitter | **Yes** | `attacks.relay` |
| A5 | **Delay** | Holds genuine frames and releases them late | **Yes** | `attacks.delay` |
| A6 | **Jamming** | Floods the band with noise | **Yes** (survivors) | `attacks.jamming` |

## The central finding: cryptography alone is blind to half the catalogue

A4–A6 deliver genuine, untouched frames. Every cryptographic check passes. The pipeline
keeps running while an attacker controls the path — this is precisely the *silent failure*
the challenge describes. It is why the design has two independent layers:

1. **Cryptography** (AES-GCM + anti-replay) decides whether a frame's *content* is genuine.
2. **Link-behaviour detection** decides whether the frame arrived the way physics says it
   should — right time, right power, right Doppler for where the satellite actually is.

## Residual risk

| Risk | Why it survives | Where it is measured |
| --- | --- | --- |
| Relay with near-perfect Doppler pre-correction and matched power | Shrinks the physical signature toward noise | Deliverable 5, evasion sweep |
| Delay smaller than timing jitter | Latency residual indistinguishable from clean | Deliverable 5, evasion sweep |
| Key compromise | Forged frames pass cryptography | Out of scope; detector still sees physics of a forger's transmitter |
| Adaptive attacker who trains against our detector | Learns the decision boundary | Deliverable 5 |
