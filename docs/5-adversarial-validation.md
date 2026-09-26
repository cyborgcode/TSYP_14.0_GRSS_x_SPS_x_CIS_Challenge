# 5 · Adversarial Validation & Response

> Phase 1 weight: **20 points** — standard scenario & evasion

## Status: standard scenario done, evasion sweep not started

The standard scenario runs all six attacks at full strength (see deliverable 4). That
proves the pipeline works; it does not prove the defence is robust. An adversary who has
read our design — explicitly in the threat model — will turn every attack down to just
below what we detect.

## Evasion sweep — the work to do

For each attack, sweep its strength parameter downward and record Pd at the fixed operating
point. Report the **detectability floor**: the weakest attack still caught with Pd ≥ 0.9.

| Attack | Parameter to sweep | From | Toward | Question answered |
| --- | --- | --- | --- | --- |
| Relay | `extra_delay_s` | 20 ms | 0.1 ms | How fast must a relay be to hide in timing jitter? |
| Relay | `doppler_bias_hz`, `doppler_noise_hz` | 300 / 100 Hz | 0 / 20 Hz | How well must it pre-correct Doppler? |
| Relay | `relay_rssi_dbm` | −82 dBm | matched to prediction | Can power matching hide it? |
| Delay | `delay_s` | 80 ms | 0.1 ms | Smallest detectable delay |
| Jamming | `jam_db` | 15 dB | 1 dB | Weakest detectable jammer |
| Inject | `rate_hz`, Doppler emulation | 2 Hz, none | low rate, emulated | Can a forger that fakes Doppler evade the detector? |

Output: one Pd-versus-strength curve per attack, plus the combined relay case where the
attacker minimises all three signatures at once — the strongest realistic adversary.

## Response policy — to define

What the station *does* when an alarm fires matters as much as the alarm:

| Trigger | Proposed response |
| --- | --- |
| Crypto rejection (auth fail, replay, stale) | Drop the frame, log it in the audit chain, count per contact |
| Detector alarm, frames cryptographically valid | Accept but **quarantine**: flag the frames as unverified-path in the product's provenance record |
| Sustained alarm over N seconds | Raise an operator alert; request retransmission on a later pass |
| Alarm + sequence gaps | Mark the gap explicitly in the record rather than leaving it silent |

The point of the policy is the challenge's core concern: a failure must never stay silent.
