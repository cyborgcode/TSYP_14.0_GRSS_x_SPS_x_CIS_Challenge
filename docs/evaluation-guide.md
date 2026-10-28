# TSYP 14 Secure Ground-Link Testbed — Evaluation Guide

Open the live testbed: <https://tsyp-cyb0rgcodes-projects.vercel.app>. The dashboard is our
simulation for TSYP 14 Track 1 (Secure Ground-Link Testbed): satellite-to-ground telemetry,
real-time threat detection and cryptographic resilience, running entirely in the browser.

## 1. Mission parameters and 3D viewport

- **Orbit and ground node**: TerraSAR-X (NORAD 31698), a sun-synchronous Low Earth Orbit radar
  satellite at 514 km, downlinking at X-band (8477.8 MHz) to our ground station in Zaghouan,
  Tunisia (GS-ZAG). The dashboard replays its next real pass over Zaghouan, from CelesTrak's
  latest element set (offline: the last download, then an element set built into the site).
- **Graphics**: Three.js with ACES Filmic tone mapping, a three-layer atmosphere (Rayleigh
  scattering, limb glow, Mie haze), and TerraSAR-X to scale: a hexagonal body in multi-layer
  insulation with gold end bulkheads, body-mounted solar cells, the phased-array radar antenna
  along a side facet and the X-band downlink antenna on its boom.
- **Controls**: drag with the mouse or a finger to orbit the camera around the Earth and the
  satellite; pinch or scroll to zoom. Click the satellite or the station to fly in and open its
  live signal view.

## 2. One continuous signal beam

The beam between TerraSAR-X and Zaghouan is one continuous signal. When an attack is triggered,
everything changes together: the beam's colour and distortion, the Carrier Frequency chart, the
RSSI chart, the received spectrum, the security banner and the cryptographic ledger.

## 3. Red-team attack scenarios

Trigger each scenario from the **Simulate attack** panel. Each one opens the packet inspection
drawer on the live frames (section 5).

| Scenario | What happens | System response |
|---|---|---|
| **Frequency Hijacking** | A rogue carrier sweeping around +14.2 MHz is injected into the link. | The carrier chart jumps to ~8492 MHz, the beam turns red with a rapid oscillation, and the ledger logs `PROOF FAIL` for every rogue frame. Keys are rotated after quarantine. |
| **Stealth Spoofing** | Node `0x99A2` injects frames with forged MAC headers and cryptographic nonces. The carrier stays on the Doppler track and the power inside a ±4 dB band, only 3.2 dB low. | The beam turns amber, RSSI degrades, the banner reads *Quarantine protocols engaged*. All three tiers fire: the data layer (forged MAC, reused nonces, wrong hardware token), the physical layer (3.2 dB is 14σ below the link budget for the chi-square engine) and the statistical layer. |
| **Data Tampering** | A relay between TerraSAR-X and Zaghouan flips one payload bit after the satellite sealed the frame. The RF is untouched. | The beam turns pink, the physical and statistical layers see nothing, and the data layer logs `HASH MISMATCH` for every altered frame. The frames are quarantined and a retransmission is requested; keys are not rotated, since the relay never had them. |
| **Noise Jamming** | Broadband Gaussian white noise saturates the receiver. | The beam turns purple with high-frequency static, RSSI drops to −96.5 dBm, frames go missing, and fallback routing to GS-MAT (Matera, Italy) is forced. |

The attack-power slider changes the jammer power and the hijacker's excess power live.
**Play demo** runs all four scenarios back to back, including a false alarm that only the
statistical layer raises: the frame is held, not rejected, and nothing escalates.

The **Three-tier threat matrix** panel shows the three tiers live, in the digital twin's order:
1. data layer (HMAC-SHA256 tag and nonce of the last frame), 2. statistical layer (Isolation
Forest score against its 0.60 operating point), 3. physical layer (chi-square against its gate
at the current elevation, and the kinematic coupling in sigma). Either deterministic layer
rejects a frame; the forest alone holds it; two tiers at once escalate.

## 4. Cryptographic ledger and telemetry verification

- **trust_anchor.py terminal** (bottom right): the live log starts from the genesis root hash and
  the spacecraft's Ed25519 public key, then shows each frame as a SHA-256 block validation, the
  Ed25519 handshakes (at session open, periodically and after every re-key), proof failures,
  forged nonces, quarantine and fallback routing.
- **Live charts**: Carrier Frequency (MHz) and RSSI Signal Strength (dBm) stream through Chart.js
  against the orbit-predicted carrier and the link budget; points the chi-square engine rejects
  turn red. The
  received spectrum (amplitude against frequency, ±20 MHz) shows the 6 MHz downlink channel, the
  hijacker at +14.2 MHz and the jammed noise floor.

## 5. Packet inspection and resilience metrics

- **Packet inspection drawer** (*Inspect packets*, or any scenario button; Esc closes it): the
  newest frames with their trust-anchor verdict, AI confidence and access decision. Selecting
  one shows the raw frame and payload hexdump (bits flipped in transit are highlighted against
  what the satellite sealed), the MAC received against the HMAC-SHA256 recomputed by the
  station, the anti-replay check, the SHA-256 digest and ledger block, the `verify_chain()`
  status; the physical layer, `security_detector.py`: range, Doppler, power and phase claimed
  against the SGP4 and ITU-R P.618 prediction, each gap in sigma, the chi-square against its
  gate and the kinematic coupling; the Isolation Forest features, score, threshold and
  confidence; and the `physics_validator.py` decision (`ACCEPTED`, `HELD` or `REJECTED`) with
  its reasons. *Live* / *Paused*
  freezes the list. The red-team label is shown for the jury only; the pipeline never reads it.
- **Resilience & trust metrics**: frames authenticated, rejected (MAC or nonce), held on RF
  evidence and corrupted frames that reached the analyst (0). `verify_chain()` re-checks the
  ledger every 5 s; *Verify* re-checks it from the genesis block, and *Edit block* lets the red
  team change a verdict recorded in a past block, which the next check reports by index before
  the block is restored. The matrix gives, per scenario, the share of frames flagged by each
  tier (data, physical, statistical) and the share stopped; hovering a stopped share gives the
  median time to the first stop. The **Detection rate** and **False-alarm rate** tiles are
  measured on the frames of the session.

## 6. Hiding in the noise

The top bar links the dashboard to four short pages, read in order with **Next** at the bottom of
each. **Signals** (`/signal`) is the signal database: CelesTrak's Earth-resources group, live
(167 satellites), every pass over Zaghouan in the next 12 hours, and the signal each pass
delivers (rise and set, culmination, Doppler, received power, SNR, slant range, atmospheric
loss). The status line says whether the element sets are live, the last download or the built-in
snapshot. Filter by name or culmination and pick a pass: its elevation, Doppler and received
power are drawn second by second, with its full parameters and where it sits against the
spoofer, the jammer and the noise floor. Every satellite is received on the station's channel
(8477.8 MHz) through the same link budget, so the signals differ by their geometry.
**Noise attacks** (`/attacks`) shows three ways an attacker imitates natural noise (noise-shaped
jamming, fade-mimicking spoofing, bit flips disguised as bit errors). **Protection**
(`/protection`) shows why each is either harmless or visible: a jammer must stay 5.3 dB below
the thermal noise before the chi-square engine fires, which costs at most 1.1 dB of SNR (the old
±4 dB box gate let 4 dB go unseen). Its **Run a below-the-gate jam** button opens the dashboard
and starts that case live. **Explainer video** (`/noise`) is a 3:00 narrated video with
chapters, captions and a transcript.

The browser ports produce the same frame text, HMAC seal and block hashes as the Python modules
in `testbed/`; both test suites check the same golden vectors.

Everything is emulation: nothing on the page transmits or receives RF.
