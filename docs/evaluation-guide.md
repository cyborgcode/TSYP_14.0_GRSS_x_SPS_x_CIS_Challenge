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

Trigger each scenario from the Red-Team Control Deck:

| Scenario | What happens | System response |
|---|---|---|
| **Frequency Hijacking** | A rogue carrier sweeping around +14.2 MHz is injected into the link. | The carrier chart jumps to ~8492 MHz, the beam turns red with a rapid oscillation, and the ledger logs `PROOF FAIL` for every rogue frame. Keys are rotated after quarantine. |
| **Stealth Spoofing** | Node `0x99A2` injects frames with forged MAC headers and cryptographic nonces. The carrier stays on track, so the physics check is evaded. | The beam turns amber, RSSI degrades, the banner reads *Quarantine protocols engaged*, and the trust anchor and AI model escalate 2 of 3. |
| **Noise Jamming** | Broadband Gaussian white noise saturates the receiver. | The beam turns purple with high-frequency static, RSSI drops to −96.5 dBm, frames go missing, and fallback routing to GS-MAT (Matera, Italy) is forced. |

The attack-power slider changes the jammer power and the hijacker's excess power live.
**Play demo** runs all three scenarios back to back, including a false alarm that the 2-of-3
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

Everything is emulation: nothing on the page transmits or receives RF.
