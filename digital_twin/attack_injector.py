"""
attack_injector.py
TSYP 14 Track 1: Secure Ground-Link Testbed
Digital twin, phase 2: red-team threat vectors against the downlink.

Each vector changes what the station receives, the way a real attacker would, and never
the truth the satellite sends:
- DELAY_SPOOFING_MEACONING: a ground repeater records the genuine signal and replays it
  late and louder. The frames are genuine and pass every cryptographic check, but the
  extra 241.8 us of light time inflates the measured range by 72.5 km while the Doppler
  still follows the satellite.
- COHERENT_PHASE_SLIP: a transmitter locked to the carrier captures the receiver's phase
  loop and slips it by 47 deg with an 18 Hz frequency pull, to walk the link off the real
  signal without breaking lock.
- CCSDS_SEQUENCE_HIJACK: a forged packet with a jumped sequence count and altered
  telemetry. The attacker recomputes the CRC and the SHA-256 digest, both public
  algorithms, and shapes its RF to look like the satellite; it cannot produce the HMAC tag.
"""

from __future__ import annotations

import copy
import logging

from .ccsds_framing import SEQUENCE_MODULO, CCSDSFrameHandler

logger = logging.getLogger("AttackInjector")

ATTACK_VECTORS = (
    "NONE",
    "DELAY_SPOOFING_MEACONING",
    "COHERENT_PHASE_SLIP",
    "CCSDS_SEQUENCE_HIJACK",
)

SPEED_OF_LIGHT_KM_S = 299_792.458
MEACONING_RANGE_INFLATION_KM = 72.5
MEACONING_GAIN_DB = 3.0
PHASE_SLIP_DEG = 47.0
PHASE_PULL_HZ = 18.0
HIJACK_SEQUENCE_JUMP = 512


class AerospaceAttackInjector:
    """Simulates aerospace threat vectors for testbed evaluation."""

    def __init__(self, framer: CCSDSFrameHandler | None = None, digest=None):
        self.framer = framer or CCSDSFrameHandler()
        # The forger can compute SHA-256 like anyone; it is given the digest function only.
        self.digest = digest

    def inject_threat(self, real_link: dict, ccsds_packet: dict, attack_mode: str) -> tuple:
        """Returns the (link, packet) the station receives under `attack_mode`."""
        if attack_mode not in ATTACK_VECTORS:
            raise ValueError(f"unknown attack vector {attack_mode!r}; expected {ATTACK_VECTORS}")
        tampered_link = copy.deepcopy(real_link)
        tampered_packet = copy.deepcopy(ccsds_packet)

        if attack_mode == "DELAY_SPOOFING_MEACONING":
            # Spoofs time delay by inflating slant range without adjusting the Doppler.
            tampered_link["slant_range_km"] += MEACONING_RANGE_INFLATION_KM
            tampered_link["light_time_us"] += (
                MEACONING_RANGE_INFLATION_KM / SPEED_OF_LIGHT_KM_S * 1e6
            )
            # The repeater amplifies signal and its own noise alike: power up, SNR unchanged.
            tampered_link["rssi_dbm"] += MEACONING_GAIN_DB

        elif attack_mode == "COHERENT_PHASE_SLIP":
            tampered_link["received_phase_error_deg"] += PHASE_SLIP_DEG
            tampered_link["doppler_shift_hz"] += PHASE_PULL_HZ

        elif attack_mode == "CCSDS_SEQUENCE_HIJACK":
            header = tampered_packet["ccsds_header"]
            header["sequence_count"] = (
                header["sequence_count"] + HIJACK_SEQUENCE_JUMP
            ) % SEQUENCE_MODULO
            tampered_packet["payload"] = {
                **tampered_packet["payload"],
                "mode": "SAFE_HOLD",
                "payload_downlink": "DISABLED",
            }
            tampered_packet = self.framer.rebuild(tampered_packet)
            if self.digest is not None:
                tampered_packet["sha256_hash"] = self.digest(tampered_packet)
            # Without the shared key the forger can only replay an old tag or guess one.

        if attack_mode != "NONE":
            logger.debug("Injected %s", attack_mode)
        return tampered_link, tampered_packet
