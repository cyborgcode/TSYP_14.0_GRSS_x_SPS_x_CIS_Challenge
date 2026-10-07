# TSYP 14 Secure Ground-Link Testbed — Evaluation Guide

Open the live testbed: <https://tsyp-cyb0rgcodes-projects.vercel.app>. The dashboard is our
simulation for TSYP 14 Track 1 (Secure Ground-Link Testbed): satellite-to-ground telemetry,
real-time threat detection and cryptographic resilience, running entirely in the browser.

## 1. Mission parameters and 3D viewport

- **Orbit and ground node**: sun-synchronous Low Earth Orbit satellite (LEO-SAT) at 542.8 km,
  downlinking at X-band (8477.8 MHz) to our ground station in Zaghouan, Tunisia (GS-ZAG).
- **Graphics**: Three.js with ACES Filmic tone mapping, a three-layer atmosphere (Rayleigh
  scattering, limb glow, Mie haze), and a satellite bus in gold-foil MLI thermal shielding with
  solar array wings.
- **Controls**: drag with the mouse or a finger to orbit the camera around the Earth and the
  satellite; pinch or scroll to zoom. Click the satellite or the station to fly in and open its
  live signal view.

## 2. One continuous signal beam

The beam between LEO-SAT and Zaghouan is one continuous signal. When an attack is triggered,
everything changes together: the beam's colour and distortion, the Carrier Frequency chart, the
RSSI chart, the received spectrum, the security banner and the cryptographic ledger.

## 3. Red-team attack scenarios

Trigger each scenario from the **Simulate attack** panel. Each one opens the packet inspection
drawer on the live frames (section 5).

| Scenario | What happens | System response |
|---|---|---|
| **Frequency Hijacking** | A rogue carrier sweeping around +14.2 MHz is injected into the link. | The carrier chart jumps to ~8492 MHz, the beam turns red with a rapid oscillation, and the ledger logs `PROOF FAIL` for every rogue frame. Keys are rotated after quarantine. |
| **Stealth Spoofing** | Node `0x99A2` injects frames with forged MAC headers and cryptographic nonces. The carrier stays on track, so the physics check is evaded. | The beam turns amber, RSSI degrades, the banner reads *Quarantine protocols engaged*, and the trust anchor and AI model escalate 2 of 3. |
| **Data Tampering** | A relay between LEO-SAT and Zaghouan flips one payload bit after the satellite sealed the frame. The RF is untouched. | The beam turns pink, the physics check and the AI model see nothing, and the trust anchor logs `HASH MISMATCH` for every altered frame. The frames are quarantined and a retransmission is requested; keys are not rotated, since the relay never had them. |
| **Noise Jamming** | Broadband Gaussian white noise saturates the receiver. | The beam turns purple with high-frequency static, RSSI drops to −96.5 dBm, frames go missing, and fallback routing to GS-MAT (Matera, Italy) is forced. |

The attack-power slider changes the jammer power and the hijacker's excess power live.
**Play demo** runs all four scenarios back to back, including a false alarm that the 2-of-3
fusion suppresses.

## 4. Cryptographic ledger and telemetry verification

- **trust_anchor.py terminal** (bottom right): the live log starts from the genesis root hash and
  the spacecraft's Ed25519 public key, then shows each frame as a SHA-256 block validation, the
  Ed25519 handshakes (at session open, periodically and after every re-key), proof failures,
  forged nonces, quarantine and fallback routing.
- **Live charts**: Carrier Frequency (MHz) and RSSI Signal Strength (dBm) stream through Chart.js
  against the orbit-predicted carrier and the link budget; points outside the gate turn red. The
  received spectrum (amplitude against frequency, ±20 MHz) shows the 6 MHz downlink channel, the
  hijacker at +14.2 MHz and the jammed noise floor.

## 5. Packet inspection and resilience metrics

- **Packet inspection drawer** (*Inspect packets*, or any scenario button; Esc closes it): the
  newest frames with their trust-anchor verdict, AI confidence and access decision. Selecting
  one shows the raw frame and payload hexdump (bits flipped in transit are highlighted against
  what the satellite sealed), the MAC received against the HMAC-SHA256 recomputed by the
  station, the anti-replay check, the SHA-256 digest and ledger block, the `verify_chain()`
  status, the `detector.py` features against their physics limits, the Isolation Forest score,
  threshold and confidence, and the `zero_trust.py` decision with its reasons. *Live* / *Paused*
  freezes the list. The red-team label is shown for the jury only; the pipeline never reads it.
- **Resilience & trust metrics**: frames authenticated, rejected (MAC or nonce), held on RF
  evidence and corrupted frames that reached the analyst (0). `verify_chain()` re-checks the
  ledger every 5 s; *Verify* re-checks it from the genesis block, and *Edit block* lets the red
  team change a verdict recorded in a past block, which the next check reports by index before
  the block is restored. The matrix gives, per scenario, the share of frames flagged by the
  trust anchor and by the detector, the share dropped, and the median time to the first drop.

## 6. Hiding in the noise

The top bar links the dashboard to four short pages, read in order with **Next** at the bottom of
each. **Signal** (`/signal`) gives the chosen signal precisely: a fixed carrier at 8477.8 MHz moved only by Doppler (±197.7 kHz at the 2°
elevation mask), received at −88.0 dBm at the mask and −74.9 dBm overhead, a carrier amplitude of
12.5 to 57.1 µV peak across the 50 Ω input, over a −100 dBm noise floor (SNR 12.0 to 25.1 dB).
**Noise attacks** (`/attacks`) shows three ways an attacker imitates natural noise (noise-shaped
jamming, fade-mimicking spoofing, bit flips disguised as bit errors). **Protection**
(`/protection`) shows why each is either harmless or visible: a jammer can add at most 1.8 dB over
the thermal noise before the physics gate fires, which costs at most 4 dB of SNR. Its **Run a
below-the-gate jam** button opens the dashboard and starts that case live. **Explainer video**
(`/noise`) is a 2:43 narrated video with chapters, captions and a transcript.

The browser ports produce the same frame text, HMAC seal and block hashes as the Python modules
in `testbed/`; both test suites check the same golden vectors.

Everything is emulation: nothing on the page transmits or receives RF.
