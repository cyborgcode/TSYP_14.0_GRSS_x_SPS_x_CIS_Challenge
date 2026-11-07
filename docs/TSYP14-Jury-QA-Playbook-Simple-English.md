# TSYP14 Jury Q&A Playbook
## Secure Ground-Link Testbed

## 30-second answer

Our project protects the radio link between the TerraSAR-X satellite and the ground
station in Zaghouan, Tunisia.

We use three checks:

1. **Data check:** Is the message real and new?
2. **Radio check:** Did the message arrive from the place and time expected?
3. **Behaviour check:** Does the link look normal?

If a message looks wrong, we do not accept it quietly. We reject it, hold it for
review, or raise an alarm.

## Main questions

### 1. What problem are you solving?

An attacker can change, copy, delay, block, or replace satellite messages.
Bad data could then reach the analyst and look real.

Our goal is to stop this **silent failure**.

### 2. What does the system protect?

It protects:

- Data sent from the satellite.
- Commands sent to the satellite.
- The order and freshness of messages.
- A record of every security decision.

### 3. Where does the system work?

The downlink goes from TerraSAR-X to the Zaghouan ground station.
The uplink sends commands back to the satellite.
If Zaghouan is jammed, the system can use the Matera station as a fallback.

### 4. Why is one security check not enough?

Each check sees a different problem.

- Encryption or message tags can detect changed data, but not a real message
  that an attacker delays or relays.
- Radio checks can detect a strange signal, but they cannot prove who created
  the data.
- Statistical checks can find unusual behaviour that the other checks miss.

Using all three gives better protection.

### 5. How do you know that a message is genuine?

Each message has an HMAC-SHA256 tag made with a secret key.
If the message is changed or forged, the tag does not match.

We also check a hardware token and a sequence number.
An old message cannot be used again as a new message.

### 6. What does the radio check measure?

It compares the received signal with what the satellite orbit predicts.
It checks:

- Distance (range)
- Frequency change (Doppler)
- Signal strength
- Signal phase

It also checks that the change in distance agrees with the Doppler reading.

### 7. What does the behaviour check do?

An Isolation Forest learns what a clean satellite pass looks like.
It looks for unusual:

- Signal errors
- Missing messages
- Arrival times
- Failed message tags
- Sudden changes

It is a second opinion, not the only decision maker.

### 8. Which attacks can you detect?

The testbed checks spoofing, replay, delay, relay, jamming, data changes,
sequence injection, phase changes, and hostile uplink commands.

### 9. Can cryptography detect jamming?

No. A jammer may block or delay a real message without changing it.
The message tag can still be correct.

That is why we also check the signal and the link behaviour.

### 10. What happens when a check fails?

- A failed tag, token, or sequence number: drop the message.
- A clear radio failure: reject the message.
- A likely jam with a genuine message: deliver it as **degraded** and raise an alarm.
- A behaviour warning only: hold the message for review.
- Two serious warnings, or several authentication failures: quarantine the link
  and start again.

Every decision is saved in a tamper-evident audit log.

### 11. What happens to hostile commands?

The satellite checks the command tag and sequence number before running it.
An altered, injected, or replayed command is refused.

In our tests, **0 of 900 hostile commands were executed**.

### 12. What are your results?

Across six test runs:

- **90,000 of 90,000 attack packets were flagged.**
- **0 corrupted frames reached the analyst.**
- About **98.4% of genuine packets were delivered cleanly**.
- The decision took about **0.3 milliseconds per packet**.
- The system used about **158 MB of Python memory**.

These tests use real public orbit and atmosphere data.
The satellite frames and radio signals are simulated.

### 13. Can an attacker still cause harm?

Yes. No security system can promise zero risk.

An attacker can still reduce link quality or make genuine messages wait for
review. Our system limits this risk, raises an alarm, and never treats a
known-bad message as clean.

### 14. What are the main limits of the test?

The tests are local and offline.
They use simulated frames and radio signals.
The station computer and secret keys are assumed safe.
Key theft and a fully compromised satellite are outside this test.

### 15. Why use simulated data?

It lets us repeat the same attacks safely and measure the result.
The orbit and atmosphere use real public data.
When official reference data is available, the same evaluation can read it.

### 16. What is the strongest design idea?

**No message is accepted silently.**

Every message is either:

- Clean and delivered
- Delivered with a warning
- Held for review
- Rejected
- Quarantined

## Simple glossary

| Word | Simple meaning |
|---|---|
| Ground link | The radio path between the satellite and the ground station |
| Telemetry | Data sent from the satellite |
| Telecommand | A command sent to the satellite |
| HMAC tag | A secret code that shows whether data was changed |
| Replay | Sending an old message again |
| Spoofing | Pretending to be the real satellite |
| Jamming | Adding noise to block or weaken the radio link |
| Doppler | Frequency change caused by movement |
| Quarantine | Stop using the link until it is checked again |
| Audit log | A record of every decision |

## Short closing statement

We protect both the data and the radio path.
We use three independent checks, test many attack types, and record every
decision. The key result is simple: bad traffic is not accepted as clean.
