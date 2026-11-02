import http.client
import json
import math
import os
import urllib.error
from pathlib import Path

import numpy as np
import pytest

pytest.importorskip("sgp4")

from digital_twin.attack_injector import (  # noqa: E402
    ATTACK_VECTORS,
    HIJACK_SEQUENCE_JUMP,
    MEACONING_RANGE_INFLATION_KM,
    ROGUE_COMMAND,
    UPLINK_THREATS,
    AerospaceAttackInjector,
)
from digital_twin.audit_logger import GENESIS_HASH, AuditLogger  # noqa: E402
from digital_twin.ccsds_framing import (  # noqa: E402
    SEQUENCE_MODULO,
    TELECOMMAND,
    CCSDSFrameHandler,
    crc16_ccitt,
)
from digital_twin.crypto_hash_verifier import (  # noqa: E402
    KEY_ENV,
    CryptoIntegrityVerifier,
    sha256_digest,
)
from digital_twin.ephemeris_loader import (  # noqa: E402
    BUILTIN_TLE,
    CACHE_ENV,
    DEFAULT_NORAD_ID,
    NORAD_ENV,
    OFFLINE_ENV,
    EphemerisLoader,
    parse_tle,
    tle_checksum,
)
from digital_twin.ephemeris_loader import main as orbit_check  # noqa: E402
from digital_twin.isolation_forest_detector import MLAnomalyDetector  # noqa: E402
from digital_twin.link_budget import (  # noqa: E402
    LinkBudgetCalculator,
    cloud_specific_attenuation,
    rain_coefficients,
)
from digital_twin.physics_validator import MasterTelemetryValidator  # noqa: E402
from digital_twin.propagation import ZONAL_HARMONICS, OrbitPropagator  # noqa: E402
from digital_twin.security_detector import (  # noqa: E402
    NATURAL_SIGMA,
    SPEED_OF_LIGHT_KM_S,
    PhysicsSecurityEngine,
    chi_square_quantile,
    chi_square_sf,
    normal_two_sided_quantile,
)
from digital_twin.visibility_calculator import VisibilityCalculator, geodetic_to_ecef  # noqa: E402
from testbed.trust_anchor import TrustAnchorLedger  # noqa: E402

KEY = os.urandom(32)
TLE = EphemerisLoader.builtin()  # a fixed orbit, so every run sees the same passes
#: TerraSAR-X's element set the way CelesTrak serves one: padded name line, CRLF line ends.
CELESTRAK_REPLY = "TERRASAR-X              \r\n" + "\r\n".join(BUILTIN_TLE[1:]) + "\r\n"


def relabel(line: str, norad_id: int) -> str:
    """A TLE line moved to another catalogue number, with its checksum redone."""
    moved = line[:2] + f"{norad_id:05d}" + line[7:68]
    return moved + str(tle_checksum(moved))


#: Another satellite's elements, which must be refused when TerraSAR-X is asked for.
OTHER_REPLY = "\r\n".join(["ISS (ZARYA)", *(relabel(line, 25544) for line in BUILTIN_TLE[1:])])
PAYLOAD = {"satellite_id": "TERRASAR-X", "mode": "IMAGING", "battery_v": 28.0}
COMMAND = {"opcode": "SET_MODE", "mode": "IMAGING"}
LINK = LinkBudgetCalculator()


@pytest.fixture(autouse=True)
def offline(tmp_path, monkeypatch):
    """No test reaches the network: CelesTrak is served by `celestrak()` where a test needs it."""
    monkeypatch.setenv(OFFLINE_ENV, "1")
    monkeypatch.setenv(CACHE_ENV, str(tmp_path / "tle-cache"))
    monkeypatch.delenv(NORAD_ENV, raising=False)


def celestrak(monkeypatch, reply) -> list:
    """Stands in for CelesTrak: every download returns `reply`, or raises it."""
    calls = []

    def download(loader):
        calls.append(loader.celestrak_url)
        if isinstance(reply, Exception):
            raise reply
        return reply

    monkeypatch.setattr(EphemerisLoader, "_download", download)
    return calls


@pytest.fixture(scope="module")
def twin(tmp_path_factory) -> MasterTelemetryValidator:
    audit = AuditLogger(tmp_path_factory.mktemp("audit") / "security_audit.jsonl")
    return MasterTelemetryValidator(tle=TLE, audit_logger=audit)


@pytest.fixture(scope="module")
def first_pass(twin) -> dict:
    return twin.next_pass(TLE["epoch_unix"], min_peak_deg=10.0)


def sealed_packet(crypto: CryptoIntegrityVerifier, sequence: int = 7) -> dict:
    return crypto.seal_packet(CCSDSFrameHandler().build_telemetry_packet(sequence, PAYLOAD, 1e9))


# ---------------------------------------------------------------- phase 1: orbit and link


def test_builtin_tle_is_valid_and_dated_at_its_epoch():
    assert TLE["norad_id"] == DEFAULT_NORAD_ID == 31698
    assert TLE["sat_name"] == "TERRASAR-X"
    assert TLE["epoch_utc"].startswith("2026-10-26T11:12:50")
    for line in BUILTIN_TLE[1:]:
        assert int(line[68]) == tle_checksum(line)


def test_a_corrupted_tle_is_refused():
    name, line1, line2 = BUILTIN_TLE
    with pytest.raises(ValueError, match="checksum"):
        parse_tle("\n".join((name, line1, line2[:20] + "9" + line2[21:])))


def test_the_twin_asks_celestrak_for_a_real_satellite(monkeypatch):
    assert EphemerisLoader().target_sat_id == DEFAULT_NORAD_ID == 31698  # TerraSAR-X
    assert EphemerisLoader().celestrak_url == (
        "https://celestrak.org/NORAD/elements/gp.php?CATNR=31698&FORMAT=TLE"
    )
    monkeypatch.setenv(NORAD_ENV, "25544")
    assert EphemerisLoader().target_sat_id == 25544


def test_a_live_download_is_flown_and_reused_for_two_hours(monkeypatch):
    calls = celestrak(monkeypatch, CELESTRAK_REPLY)
    loader = EphemerisLoader(DEFAULT_NORAD_ID)
    live = loader.fetch_latest_tle(online=True)
    again = loader.fetch_latest_tle(online=True)

    assert live["source"] == "celestrak"
    assert live["sat_name"] == "TERRASAR-X"
    assert live["line2"] == BUILTIN_TLE[2]
    assert live["fetched_utc"] is not None
    assert loader.cache_path.exists()
    assert again["source"] == "cache"
    assert len(calls) == 1  # CelesTrak refreshes every two hours: no second download


def test_the_network_is_the_default_and_offline_mode_stays_off_it(monkeypatch):
    calls = celestrak(monkeypatch, CELESTRAK_REPLY)
    monkeypatch.delenv(OFFLINE_ENV)
    assert EphemerisLoader(DEFAULT_NORAD_ID).fetch_latest_tle()["source"] == "celestrak"

    monkeypatch.setenv(OFFLINE_ENV, "1")
    assert EphemerisLoader(DEFAULT_NORAD_ID).fetch_latest_tle()["source"] == "stale-cache"
    assert len(calls) == 1


@pytest.mark.parametrize(
    "failure",
    [
        urllib.error.URLError("no route to celestrak.org"),
        urllib.error.HTTPError("https://celestrak.org", 503, "Service Unavailable", None, None),
        TimeoutError("timed out"),
        http.client.IncompleteRead(b"1 31698U"),
    ],
)
def test_offline_the_last_good_download_flies(monkeypatch, failure):
    celestrak(monkeypatch, CELESTRAK_REPLY)
    loader = EphemerisLoader(DEFAULT_NORAD_ID)
    loader.fetch_latest_tle(online=True)
    record = json.loads(loader.cache_path.read_text())
    record["fetched_unix"] -= 3 * 3600.0  # older than CelesTrak's refresh: go back online
    loader.cache_path.write_text(json.dumps(record))
    celestrak(monkeypatch, failure)
    fallback = loader.fetch_latest_tle(online=True)

    assert fallback["source"] == "stale-cache"
    assert fallback["line1"] == BUILTIN_TLE[1]


@pytest.mark.parametrize("reply", ["No GP data found", OTHER_REPLY])
def test_a_bad_reply_with_no_cache_flies_the_builtin_orbit(monkeypatch, reply):
    # TerraSAR-X is asked for; an empty answer or another satellite's elements are refused.
    celestrak(monkeypatch, reply)
    tle = EphemerisLoader(DEFAULT_NORAD_ID).fetch_latest_tle(online=True)

    assert tle["source"] == "builtin"
    assert tle["norad_id"] == DEFAULT_NORAD_ID
    assert tle["line1"] == BUILTIN_TLE[1]
    assert not EphemerisLoader(DEFAULT_NORAD_ID).cache_path.exists()


def test_the_live_check_fails_without_celestrak(monkeypatch, capsys):
    celestrak(monkeypatch, urllib.error.URLError("blocked"))
    assert orbit_check(["--require-live"]) == 1

    celestrak(monkeypatch, CELESTRAK_REPLY)
    assert orbit_check(["--require-live"]) == 0
    assert "live from CelesTrak" in capsys.readouterr().out


def test_the_twin_flies_the_live_orbit_by_default(monkeypatch):
    celestrak(monkeypatch, CELESTRAK_REPLY)
    monkeypatch.delenv(OFFLINE_ENV)

    assert MasterTelemetryValidator(training_passes=2).tle["source"] == "celestrak"


def test_sgp4_state_matches_the_orbit():
    state = OrbitPropagator(TLE).propagate_eci_state(TLE["epoch_unix"])
    radius = math.dist(state["position_eci_km"], (0.0, 0.0, 0.0))
    speed = math.dist(state["velocity_eci_km_s"], (0.0, 0.0, 0.0))

    assert state["frame"] == "TEME"
    assert 6378.137 + 495.0 < radius < 6378.137 + 535.0
    assert speed == pytest.approx(7.61, abs=0.05)


def test_j2_turns_the_orbit_plane_at_the_sun_synchronous_rate():
    propagator = OrbitPropagator(TLE)

    def node_deg(t):
        state = propagator.propagate_eci_state(t)
        hx, hy, _ = np.cross(state["position_eci_km"], state["velocity_eci_km_s"])
        return math.degrees(math.atan2(hx, -hy))

    drift = (node_deg(TLE["epoch_unix"] + 10 * 86400.0) - node_deg(TLE["epoch_unix"])) % 360.0
    assert ZONAL_HARMONICS["J2"] == pytest.approx(1.082616e-3)
    assert drift / 10.0 == pytest.approx(360.0 / 365.2422, abs=0.01)


def test_free_space_loss_at_the_mask_range():
    # FSPL = 20 log10(4 pi d f / c) at 2470 km and 8477.8 MHz.
    assert LINK.free_space_loss_db(2470.0) == pytest.approx(178.86, abs=0.01)


def test_rain_coefficients_match_the_p838_table():
    # ITU-R P.838-3 at 10 GHz: k_H 0.01217, alpha_H 1.2571, k_V 0.01129, alpha_V 1.2156.
    assert rain_coefficients(10.0, 0.0, 0.0) == pytest.approx((0.01217, 1.2571), rel=1e-3)
    assert rain_coefficients(10.0, 0.0, 90.0) == pytest.approx((0.01129, 1.2156), rel=1e-3)
    assert cloud_specific_attenuation(8.4778) == pytest.approx(0.06671, rel=1e-3)


@pytest.mark.parametrize(
    ("contribution", "elevation", "percent", "reference_db"),
    [
        # Reference values: the itur implementation of P.618-13, P.840-7 and P.676-10
        # Annex 2, with the same Zaghouan inputs.
        ("rain_attenuation_db", 30.0, 0.01, 2.2479),
        ("rain_attenuation_db", 10.0, 0.1, 1.4316),
        ("rain_attenuation_db", 5.0, 1.0, 0.5533),
        ("rain_attenuation_db", 2.0, 0.01, 13.3225),
        ("cloud_attenuation_db", 30.0, 5.0, 0.04836),
        ("scintillation_attenuation_db", 10.0, 1.0, 0.76323),
        ("gaseous_attenuation_db", 90.0, 50.0, 0.0472),
        ("gaseous_attenuation_db", 20.0, 50.0, 0.1379),
    ],
)
def test_itu_r_attenuation_matches_the_reference(contribution, elevation, percent, reference_db):
    assert getattr(LINK, contribution)(elevation, percent) == pytest.approx(reference_db, rel=3e-3)


def test_low_elevation_gas_follows_the_curved_path():
    # Full P.676 ray tracing gives 1.116 dB at 2 deg; the plain cosecant law gives 1.35 dB.
    assert LINK.gaseous_attenuation_db(2.0, 50.0) == pytest.approx(1.116, rel=0.06)


def test_the_median_atmosphere_is_clear_sky_and_fades_deepen_with_availability():
    median = LINK.atmospheric_attenuation(10.0)
    fades = [LINK.atmospheric_loss_db(10.0, p) for p in (5.0, 1.0, 0.1, 0.01, 0.001)]

    assert median["exceedance_percent"] == 50.0
    assert median["rain_db"] == median["cloud_db"] == 0.0
    assert median["total_db"] == pytest.approx(median["gaseous_db"], abs=1e-3)
    assert fades == sorted(fades)
    assert LINK.rain_attenuation_db(10.0, 6.0) == 0.0


def test_the_website_flies_the_twins_atmosphere():
    """dashboard/src/data/p618.json is this model, regenerated by dashboard/scripts/gen-p618.py."""
    path = Path(__file__).resolve().parents[1] / "dashboard" / "src" / "data" / "p618.json"
    table = json.loads(path.read_text(encoding="utf-8"))

    assert table["carrierMHz"] == pytest.approx(LINK.freq_hz / 1e6)
    assert table["exceedancePercent"] == 50.0
    assert table["elevationDeg"] == sorted(table["elevationDeg"])
    uplink = LinkBudgetCalculator(carrier_freq_hz=table["uplinkCarrierMHz"] * 1e6)
    for el, db, up in zip(
        table["elevationDeg"], table["totalDb"], table["uplinkTotalDb"], strict=True
    ):
        assert db == pytest.approx(LINK.atmospheric_loss_db(el), abs=1e-4)
        assert up == pytest.approx(uplink.atmospheric_loss_db(el), abs=1e-4)


def test_scintillation_grows_toward_the_horizon():
    sigmas = [LINK.scintillation_sigma_db(el) for el in (90.0, 30.0, 10.0, 5.0)]

    assert sigmas == sorted(sigmas)
    assert sigmas[-1] / sigmas[0] > 10.0


def test_an_approaching_satellite_shifts_the_carrier_up():
    link = LinkBudgetCalculator().compute_rf_link(
        sat_pos=[7000.0, 0.0, 0.0], sat_vel=[-1.0, 0.0, 0.0], gs_pos=[6378.0, 0.0, 0.0]
    )

    assert link["range_rate_km_s"] == pytest.approx(-1.0)
    assert link["doppler_shift_hz"] == pytest.approx(8477.8e6 * 1000.0 / 299_792_458.0)
    assert link["rssi_dbm"] == pytest.approx(-100.0 + link["snr_db"])


def test_station_sits_on_the_ellipsoid():
    assert 6365.0 < math.dist(geodetic_to_ecef(36.4, 10.14, 0.18), (0.0, 0.0, 0.0)) < 6375.0


def test_next_pass_is_bracketed_by_the_elevation_mask(first_pass):
    propagator = OrbitPropagator(TLE)
    vis = VisibilityCalculator()
    rise, peak, fall = vis.elevations(
        propagator, [first_pass["aos_unix"], first_pass["tca_unix"], first_pass["los_unix"]]
    )

    assert first_pass["aos_unix"] < first_pass["tca_unix"] < first_pass["los_unix"]
    assert 60.0 < first_pass["duration_s"] < 900.0
    assert rise == pytest.approx(2.0, abs=1e-3)
    assert fall == pytest.approx(2.0, abs=1e-3)
    assert peak == pytest.approx(first_pass["max_elevation_deg"])


# ---------------------------------------------------------------- phase 2: packet and layers


def test_crc16_check_value():
    assert crc16_ccitt(b"123456789") == 0x29B1


def test_space_packet_round_trips_with_a_valid_crc():
    packet = CCSDSFrameHandler().build_telemetry_packet(SEQUENCE_MODULO + 5, PAYLOAD, 1e9)
    parsed = CCSDSFrameHandler.parse_telemetry_packet(bytes.fromhex(packet["raw_hex"]))

    assert parsed["crc_valid"]
    assert parsed["ccsds_header"] == packet["ccsds_header"]
    assert parsed["ccsds_header"]["sequence_count"] == 5
    assert parsed["payload"] == PAYLOAD


def test_a_flipped_bit_breaks_the_crc():
    raw = bytearray.fromhex(CCSDSFrameHandler().build_telemetry_packet(1, PAYLOAD)["raw_hex"])
    raw[20] ^= 0x01

    assert not CCSDSFrameHandler.parse_telemetry_packet(bytes(raw))["crc_valid"]


def test_a_sealed_packet_verifies():
    crypto = CryptoIntegrityVerifier(KEY)
    verdict = crypto.verify_packet_integrity(sealed_packet(crypto))

    assert verdict["integrity_passed"]
    assert verdict["verdict"] == "CRYPTOGRAPHIC_VERIFIED"


def test_an_edited_payload_fails_the_hash_and_the_tag():
    crypto = CryptoIntegrityVerifier(KEY)
    packet = sealed_packet(crypto)
    packet["payload"]["mode"] = "SAFE_HOLD"
    verdict = crypto.verify_packet_integrity(packet)

    assert not verdict["hash_valid"]
    assert not verdict["signature_valid"]
    assert verdict["verdict"] == "CRYPTO_INTEGRITY_BREACH"


def test_a_recomputed_hash_cannot_replace_the_keyed_tag():
    crypto = CryptoIntegrityVerifier(KEY)
    packet = sealed_packet(crypto)
    packet["payload"]["mode"] = "SAFE_HOLD"
    packet["sha256_hash"] = sha256_digest(packet)
    verdict = crypto.verify_packet_integrity(packet)

    assert verdict["hash_valid"]
    assert not verdict["signature_valid"]
    assert not verdict["integrity_passed"]


def test_the_key_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv(KEY_ENV, KEY.hex())

    assert CryptoIntegrityVerifier().secret_key == KEY
    with pytest.raises(ValueError):
        CryptoIntegrityVerifier(b"short")


def test_meaconing_lengthens_the_path_and_leaves_the_input_untouched():
    link = LinkBudgetCalculator().compute_rf_link([7000.0, 0, 0], [0, 7.5, 0], [6378.0, 0, 0])
    packet = sealed_packet(CryptoIntegrityVerifier(KEY))
    before = json.dumps([link, packet], sort_keys=True)
    rx_link, rx_packet = AerospaceAttackInjector().inject_threat(
        link, packet, "DELAY_SPOOFING_MEACONING"
    )

    assert rx_link["slant_range_km"] == pytest.approx(
        link["slant_range_km"] + MEACONING_RANGE_INFLATION_KM
    )
    assert rx_link["doppler_shift_hz"] == link["doppler_shift_hz"]
    assert rx_packet == packet
    assert json.dumps([link, packet], sort_keys=True) == before


def test_a_hijacked_packet_has_a_valid_crc_but_a_stale_tag():
    crypto = CryptoIntegrityVerifier(KEY)
    packet = sealed_packet(crypto, sequence=10)
    _, hijacked = AerospaceAttackInjector(digest=sha256_digest).inject_threat(
        {}, packet, "CCSDS_SEQUENCE_HIJACK"
    )
    parsed = CCSDSFrameHandler.parse_telemetry_packet(bytes.fromhex(hijacked["raw_hex"]))

    assert parsed["crc_valid"]
    assert parsed["ccsds_header"]["sequence_count"] == 10 + HIJACK_SEQUENCE_JUMP
    assert parsed["payload"]["payload_downlink"] == "DISABLED"
    verdict = crypto.verify_packet_integrity(hijacked)
    assert verdict["hash_valid"]
    assert not verdict["signature_valid"]


def test_an_unknown_vector_is_refused():
    with pytest.raises(ValueError):
        AerospaceAttackInjector().inject_threat({}, {}, "JAMMING")
    with pytest.raises(ValueError):
        AerospaceAttackInjector().inject_uplink_threat({}, "JAMMING")


def test_a_telecommand_round_trips_as_packet_type_1():
    packet = CCSDSFrameHandler().build_telecommand_packet(3, COMMAND, 1e9)
    parsed = CCSDSFrameHandler.parse_telemetry_packet(bytes.fromhex(packet["raw_hex"]))

    assert parsed["ccsds_header"]["packet_type"] == TELECOMMAND
    assert parsed["crc_valid"]
    assert parsed["payload"] == COMMAND


@pytest.mark.parametrize("threat", ["COMMAND_TAMPERING", "COMMAND_INJECTION"])
def test_a_tampered_or_injected_command_fails_the_tag(threat):
    crypto = CryptoIntegrityVerifier(KEY)
    sealed = crypto.seal_packet(CCSDSFrameHandler().build_telecommand_packet(3, COMMAND, 1e9))
    received = AerospaceAttackInjector(digest=sha256_digest).inject_uplink_threat(sealed, threat)
    parsed = CCSDSFrameHandler.parse_telemetry_packet(bytes.fromhex(received["raw_hex"]))
    verdict = crypto.verify_packet_integrity(received)

    assert parsed["crc_valid"]
    assert parsed["ccsds_header"]["packet_type"] == TELECOMMAND
    assert parsed["payload"]["opcode"] == ROGUE_COMMAND["opcode"]
    assert verdict["hash_valid"]
    assert not verdict["signature_valid"]


def test_chi_square_gate_matches_the_false_alarm_rate():
    gate = chi_square_quantile(1.0 - 1e-4, 4)

    assert chi_square_sf(gate, 4) == pytest.approx(1e-4, rel=1e-6)
    assert gate == pytest.approx(23.51, abs=0.01)


def test_the_gate_widens_toward_the_horizon():
    engine = PhysicsSecurityEngine()

    assert engine.adaptive_threshold(90.0) == pytest.approx(engine.base_threshold)
    assert engine.adaptive_threshold(0.0) == pytest.approx(3.0 * engine.base_threshold)


def test_physics_names_the_residual_that_breaks_the_gate():
    truth = dict.fromkeys(NATURAL_SIGMA, 0.0)
    rx = {**truth, "doppler_shift_hz": 10.0 * NATURAL_SIGMA["doppler_shift_hz"]}
    engine = PhysicsSecurityEngine()

    assert engine.evaluate_telemetry_physics(truth, truth, 45.0)["verdict"] == "PHYSICS_CONSISTENT"
    verdict = engine.evaluate_telemetry_physics(rx, truth, 45.0)
    assert verdict["chi_square_value"] == pytest.approx(100.0)
    assert verdict["dominant_residual"] == "doppler_shift_hz"
    assert verdict["verdict"] == "PHYSICS_VIOLATION"


def closing_pair(range_rate_km_s: float = -5.0, dt: float = 10.0) -> tuple[dict, dict]:
    """Two noiseless measurements, `dt` apart, of a satellite closing at a steady rate."""
    doppler = -range_rate_km_s / SPEED_OF_LIGHT_KM_S * 8477.8e6
    first = {**dict.fromkeys(NATURAL_SIGMA, 0.0), "slant_range_km": 1500.0}
    first["doppler_shift_hz"] = doppler
    return first, {**first, "slant_range_km": 1500.0 + range_rate_km_s * dt}


def test_the_kinematic_error_bound_follows_the_orbit(twin):
    # 1.33e-3 km/s^3 is the largest range jerk measured over 60 TerraSAR-X passes.
    assert 1.33e-3 < twin.physics_engine.range_jerk_bound_km_s3 < 2e-3


def test_the_kinematic_gate_matches_the_false_alarm_rate():
    gate = normal_two_sided_quantile(1e-4)

    assert math.erfc(gate / math.sqrt(2.0)) == pytest.approx(1e-4, rel=1e-6)
    assert gate == pytest.approx(3.89, abs=0.01)


def test_a_range_that_follows_its_doppler_is_consistent():
    first, second = closing_pair()
    engine = PhysicsSecurityEngine()
    opening = engine.evaluate_telemetry_physics(first, first, 45.0, 0.0)
    verdict = engine.evaluate_telemetry_physics(second, second, 45.0, 10.0)["kinematic_coupling"]

    assert opening["kinematic_coupling"]["verdict"] == "KINEMATIC_NO_REFERENCE"
    assert verdict["verdict"] == "KINEMATIC_CONSISTENT"
    assert verdict["residual_km"] == pytest.approx(0.0, abs=1e-9)


def test_a_range_step_without_its_doppler_breaks_the_coupling():
    # The orbit prediction agrees with each claim, as a stale element set could; only the
    # coupling between range and Doppler gives the 5 km step away.
    first, second = closing_pair()
    stepped = {**second, "slant_range_km": second["slant_range_km"] + 5.0}
    engine = PhysicsSecurityEngine()
    engine.evaluate_telemetry_physics(first, first, 45.0, 0.0)
    verdict = engine.evaluate_telemetry_physics(stepped, stepped, 45.0, 10.0)

    assert not verdict["chi_square_breach"]
    assert verdict["kinematic_coupling"]["verdict"] == "KINEMATIC_VIOLATION"
    assert verdict["verdict"] == "PHYSICS_VIOLATION"
    assert engine.anchor["timestamp"] == 0.0  # a rejected measurement never anchors


def test_a_stale_reference_is_not_used():
    first, second = closing_pair(dt=60.0)
    engine = PhysicsSecurityEngine()
    engine.evaluate_telemetry_physics(first, first, 45.0, 0.0)
    verdict = engine.evaluate_telemetry_physics(second, second, 45.0, 60.0)

    assert verdict["kinematic_coupling"]["verdict"] == "KINEMATIC_NO_REFERENCE"


def test_the_ml_layer_needs_training_first():
    with pytest.raises(RuntimeError):
        MLAnomalyDetector().evaluate_packet({})
    with pytest.raises(ValueError):
        MLAnomalyDetector().fit([])


# ---------------------------------------------------------------- phase 3: audit and twin


def test_the_audit_chain_shares_the_ledger_genesis(tmp_path):
    first = AuditLogger(tmp_path / "audit.jsonl").log_telemetry_event({"decision": "ACCEPTED"})

    assert TrustAnchorLedger(KEY).genesis_root == GENESIS_HASH
    assert first["previous_hash"] == GENESIS_HASH


def test_the_audit_log_detects_an_edited_entry(tmp_path):
    path = tmp_path / "audit.jsonl"
    log = AuditLogger(path)
    for decision in ("ACCEPTED", "REJECTED", "HELD"):
        log.log_telemetry_event({"final_decision": decision})
    assert log.verify_log()[0]

    lines = path.read_text().splitlines()
    lines[1] = lines[1].replace("REJECTED", "ACCEPTED")
    path.write_text("\n".join(lines) + "\n")
    ok, message = AuditLogger(path).verify_log()
    assert not ok
    assert "entry 1" in message


def test_a_reopened_audit_log_continues_its_chain(tmp_path):
    path = tmp_path / "audit.jsonl"
    AuditLogger(path).log_telemetry_event({"n": 1})
    entry = AuditLogger(path).log_telemetry_event({"n": 2})

    assert entry["index"] == 1
    assert AuditLogger(path).verify_log() == (
        True,
        "Audit log intact: 2 entries chained to the genesis root.",
    )


def test_no_link_below_the_mask(twin, first_pass):
    tick = twin.run_simulation_tick(first_pass["aos_unix"] - 600.0)

    assert not tick["link_available"]
    assert tick["final_decision"] == "NO_LINK"


def test_a_clean_tick_at_culmination_is_accepted(twin, first_pass):
    tick = twin.run_simulation_tick(first_pass["tca_unix"])

    assert tick["final_decision"] == "ACCEPTED"
    assert tick["crypto_result"]["integrity_passed"]
    assert not tick["security_result"]["physical_breach_detected"]


@pytest.mark.parametrize(
    ("vector", "layer"),
    [
        ("DELAY_SPOOFING_MEACONING", "physics_flagged"),
        ("COHERENT_PHASE_SLIP", "physics_flagged"),
        ("CCSDS_SEQUENCE_HIJACK", "crypto_flagged"),
    ],
)
def test_every_attack_tick_in_a_pass_is_stopped(twin, first_pass, vector, layer):
    report = twin.run_pass(vector, start=first_pass["aos_unix"])

    assert report["attack_ticks"] > 0
    assert report["attack_stopped"] == 1.0
    assert report["attack_rejected"] == 1.0
    assert report[layer] == 1.0
    assert report["clean_rejected"] == 0.0


def test_the_meaconing_onset_breaks_the_range_doppler_coupling(twin, first_pass):
    report = twin.run_pass("DELAY_SPOOFING_MEACONING", start=first_pass["aos_unix"])
    onset = next(t for t in report["ticks"] if t["red_team_vector"] != "NONE")
    clean = [t for t in report["ticks"] if t["red_team_vector"] == "NONE" and t["link_available"]]

    assert onset["security_result"]["kinematic_coupling"]["verdict"] == "KINEMATIC_VIOLATION"
    assert not any(t["security_result"]["kinematic_coupling"]["kinematic_breach"] for t in clean)


@pytest.mark.parametrize(
    ("threat", "decision"),
    [("NONE", "EXECUTED"), ("COMMAND_TAMPERING", "REJECTED"), ("COMMAND_INJECTION", "REJECTED")],
)
def test_only_genuine_uplink_commands_execute(twin, threat, decision):
    result = twin.run_uplink_command(COMMAND, threat, timestamp=TLE["epoch_unix"])

    assert result["direction"] == "UPLINK"
    assert result["final_decision"] == decision


def test_the_validator_refuses_an_unknown_vector(twin, first_pass):
    with pytest.raises(ValueError):
        twin.run_simulation_tick(first_pass["tca_unix"], "JAMMING")
    with pytest.raises(ValueError):
        twin.run_uplink_command(COMMAND, "JAMMING")


def test_every_tick_reaches_an_intact_audit_log(twin):
    ok, message = twin.audit.verify_log()

    assert ok, message


# ---------------------------------------------------------------- interfaces


def test_api_gateway(twin, first_pass, monkeypatch):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from digital_twin import api_gateway

    monkeypatch.setattr(api_gateway, "get_validator", lambda: twin)
    client = TestClient(api_gateway.app)

    health = client.get("/health").json()
    assert health["satellite"] == "TERRASAR-X"
    assert health["orbit_source"] == "given"
    assert client.get("/orbit").json()["line2"] == TLE["line2"]
    assert client.get("/attack-vectors").json() == list(ATTACK_VECTORS)
    found = client.get("/pass/next", params={"start": TLE["epoch_unix"]}).json()
    assert found["tca_unix"] == pytest.approx(first_pass["tca_unix"])

    tick = client.post(
        "/simulate/tick",
        json={"attack_vector": "COHERENT_PHASE_SLIP", "timestamp": first_pass["tca_unix"]},
    )
    assert tick.status_code == 200
    assert tick.json()["final_decision"] == "REJECTED"
    assert client.post("/simulate/tick", json={"attack_vector": "JAMMING"}).status_code == 400

    report = client.post(
        "/simulate/pass",
        json={"attack_vector": "CCSDS_SEQUENCE_HIJACK", "start": first_pass["aos_unix"]},
    ).json()
    assert report["attack_stopped"] == 1.0
    assert set(report["ticks"][0]) == {"utc", "elevation_deg", "red_team_vector", "final_decision"}

    assert client.get("/uplink/threats").json() == list(UPLINK_THREATS)
    uplink = client.post(
        "/uplink/command", json={"command": COMMAND, "threat": "COMMAND_INJECTION"}
    )
    assert uplink.json()["final_decision"] == "REJECTED"
    assert client.post("/uplink/command", json={"threat": "JAMMING"}).status_code == 400

    fade = client.get("/link/attenuation", params={"elevation_deg": 10.0, "p": 0.01}).json()
    assert fade["total_db"] == pytest.approx(LINK.atmospheric_loss_db(10.0, 0.01))
    assert client.get("/link/attenuation", params={"elevation_deg": 95.0}).status_code == 422
    assert client.get("/audit/verify").json()["intact"]


def test_dashboard_runs_a_tick(tmp_path, monkeypatch):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest

    monkeypatch.setenv("GROUNDLINK_AUDIT_LOG", str(tmp_path / "audit.jsonl"))
    app = AppTest.from_file("../digital_twin/dashboard_ui.py", default_timeout=120).run()
    assert not app.exception

    # A clean tick at culmination, then a meaconed one 15 s later.
    app.sidebar.button[0].click().run()
    labels = {metric.label: metric.value for metric in app.metric}
    assert labels["Range-Doppler coupling"] == "no reference"
    assert labels["Atmospheric loss (ITU-R P.618)"].endswith(" dB")

    app.sidebar.slider[0].set_value(app.sidebar.slider[0].value + 0.25)
    app.sidebar.selectbox[0].set_value("DELAY_SPOOFING_MEACONING")
    app.sidebar.button[0].click().run()
    assert not app.exception
    labels = {metric.label: metric.value for metric in app.metric}
    assert labels["Final decision"] == "REJECTED"
    assert labels["Dominant residual"] == "slant_range_km"
    assert labels["Range-Doppler coupling"].endswith("sigma")
    assert len(app.dataframe[0].value) == 5  # the kinematic row joins the four residuals


def test_the_seeded_evaluation_stops_every_attack_packet():
    from digital_twin.evaluate import ATTACKS, EVASION, run_seed

    result = run_seed(3, n_train=400, n_nominal=160, bursts=2, burst_len=10, uplink_commands=5)
    counts = result["counts"]
    for attack in ATTACKS:
        assert counts[attack]["n"] == 20
        assert counts[attack]["DELIVERED"] == 0, attack
    # Genuine frames verify, and the forest alone only ever holds them.
    assert counts["NONE"]["data"] == 0
    assert counts["NONE"]["REJECTED"] + counts["NONE"]["QUARANTINED"] <= 1
    # Below the gate the jam costs little SNR and every frame still verifies.
    demo = counts["JAM_BELOW_GATE_DEMO"]
    assert demo["verified"] == demo["n"]
    assert demo["snr_loss_db"] / demo["n"] < 0.3
    edge = counts["JAM_AT_STEALTH_LIMIT"]
    assert abs(edge["snr_loss_db"] / edge["n"] - 1.115) < 0.01
    assert set(EVASION) <= set(counts)
    assert all(u["executed"] == 0 for u in result["uplink"].values())
