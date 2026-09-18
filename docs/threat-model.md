# Threat model — ground segment (Track 1)

> Deliverable 1 of 6. Phase 1 weight: 15 / 100.

## Segment under defence

The RF path and receiver front-end that deliver positioning, timing and downlink data to
the ground station, and the observation record derived from them. Everything downstream
(products, analytics) trusts that record, so corrupting it silently corrupts every decision
built on top.

## Assets

| Asset | Why it matters | Loss if compromised |
| --- | --- | --- |
| Receiver observables (C/N0, AGC, pseudorange, clock) | Primary evidence of link health | Undetected degradation |
| Position / time solution | Georeferencing and timestamping of products | Mislocated or misdated imagery |
| Observation log | Audit trail presented to the analyst | Unprovable provenance |

## Adversary model

- **Capability:** commodity SDR transmitter, within RF line of sight, able to transmit at
  power comparable to or above the received signal. No cryptographic key material.
- **Knowledge:** public signal structure; may observe the defender's published detector.
- **Goal:** cause the receiver to output a wrong-but-plausible solution, or deny service,
  without tripping an alarm.
- **Out of scope:** physical access to the ground station, supply-chain implants, and
  compromise of the trust anchor key.

## Attack catalogue

| # | Attack | Mechanism | Observable signature | Implemented in |
| --- | --- | --- | --- | --- |
| A1 | Broadband jamming | Raise the noise floor | C/N0 falls on all channels; AGC backs off | `core.attacks.broadband_jamming` |
| A2 | Spoofing | Counterfeit constellation from one transmitter | Inter-channel C/N0 spread collapses; clock solution steps; AGC unchanged | `core.attacks.spoofing` |
| A3 | Meaconing (replay) | Rebroadcast authentic signal on a delay | Common-mode pseudorange bias; inter-channel structure preserved | `core.attacks.meaconing` |
| A4 | Post-hoc record edit | Alter the stored observation log | Hash chain / MAC fails | `core.trust` (verification) |

## Why the silent-failure case drives the design

A1 is loud: the operator notices. A2 and A3 are the dangerous ones — the pipeline keeps
producing output at normal quality indicators while the content is wrong. That is why the
detector uses **inter-channel structure** (spread collapse) and **common-mode tests**
rather than signal strength alone: an AGC- or C/N0-only monitor passes A2 and A3 cleanly.

## Residual risk

- An adversary who raises power slowly enough to stay inside the robust baseline's drift.
- An adversary who preserves inter-channel spread by using multiple coordinated
  transmitters, defeating the A2 signature.
- Key compromise voids the trust anchor entirely; the chain proves integrity, not secrecy.

These are the cases the adversarial-validation deliverable must quantify, not assume away.
