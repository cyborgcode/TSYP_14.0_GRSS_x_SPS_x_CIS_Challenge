# 3 · Signal / Image Processing

> Phase 1 weight: **15 points**

The station knows the orbit, so for every instant it can predict what the link *should*
look like. Signal processing turns each reception into **residuals against that
prediction**. Removing the orbital trend is the key step: raw Doppler swings ±54 kHz over a
pass and received power moves ~13 dB, which would drown any attack signature.

## Features (per frame)

| Feature | Definition | Clean behaviour | Attack it exposes |
| --- | --- | --- | --- |
| `snr_db` | Received signal-to-noise ratio | Follows elevation | Jamming |
| `rssi_residual_db` | Received power − free-space prediction | ≈ 0 ± 1 dB | Relay, jamming, injection |
| `doppler_residual_hz` | Measured − predicted Doppler | ≈ 0 ± 20 Hz | Injection, replay, relay |
| `latency_residual_ms` | Arrival − timestamp − light time − processing | ≈ 0 ± 0.2 ms | Delay, relay, replay |
| `inter_arrival_ms` | Gap since previous frame | ≈ 100 ms | Injection, replay, jamming loss |
| `sequence_step` | Header sequence − previous | 1 | Replay, jamming loss |

All six are read from what the receiver physically measured plus the frame header as
observed — including frames cryptography rejected — so the detector stays independent of
the cryptographic layer and each can be evaluated on its own.

## Link model

`groundlink/channel.py`: TerraSAR-X's 514 km altitude, 7.6 km/s ground speed, 600 s pass,
S-band carrier at 2.2 GHz (its TT&C band), free-space power loss, measurement noise of 1 dB (power), 20 Hz (Doppler),
0.2 ms (timing). Flat-Earth pass geometry — sufficient for one pass, and replaceable by a
real propagator without changing any caller.

## Limitations

- Perfect ephemeris is assumed. Real orbit prediction error adds bias to the Doppler and
  latency residuals; it must be measured on the official datasets and folded into the noise.
- No multipath, atmospheric or antenna-pattern effects yet.
