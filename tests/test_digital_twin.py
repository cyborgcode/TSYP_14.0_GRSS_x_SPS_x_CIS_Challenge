import json
import math
import os

import pytest

pytest.importorskip("sgp4")

from digital_twin.attack_injector import (  # noqa: E402
    ATTACK_VECTORS,
    HIJACK_SEQUENCE_JUMP,
    MEACONING_RANGE_INFLATION_KM,
    AerospaceAttackInjector,
)
from digital_twin.audit_logger import GENESIS_HASH, AuditLogger  # noqa: E402
from digital_twin.ccsds_framing import (  # noqa: E402
    SEQUENCE_MODULO,
    CCSDSFrameHandler,
    crc16_ccitt,
)
from digital_twin.crypto_hash_verifier import (  # noqa: E402
    KEY_ENV,
    CryptoIntegrityVerifier,
    sha256_digest,
)
from digital_twin.ephemeris_loader import (  # noqa: E402
    LEO_SAT_TLE,
    EphemerisLoader,
    parse_tle,
    tle_checksum,
)
from digital_twin.isolation_forest_detector import MLAnomalyDetector  # noqa: E402
from digital_twin.link_budget import LinkBudgetCalculator, air_mass  # noqa: E402
from digital_twin.physics_validator import MasterTelemetryValidator  # noqa: E402
from digital_twin.propagation import OrbitPropagator  # noqa: E402
from digital_twin.security_detector import (  # noqa: E402
    NATURAL_SIGMA,
    PhysicsSecurityEngine,
    chi_square_quantile,
    chi_square_sf,
)
from digital_twin.visibility_calculator import VisibilityCalculator, geodetic_to_ecef  # noqa: E402
from testbed.trust_anchor import TrustAnchorLedger  # noqa: E402

KEY = os.urandom(32)
TLE = EphemerisLoader().fetch_latest_tle()
PAYLOAD = {"satellite_id": "LEO-SAT-542", "mode": "IMAGING", "battery_v": 28.0}


@pytest.fixture(scope="module")
def twin(tmp_path_factory) -> MasterTelemetryValidator:
    audit = AuditLogger(tmp_path_factory.mktemp("audit") / "security_audit.jsonl")
    return MasterTelemetryValidator(audit_logger=audit)


@pytest.fixture(scope="module")
def first_pass(twin) -> dict:
    return twin.next_pass(TLE["epoch_unix"])


def sealed_packet(crypto: CryptoIntegrityVerifier, sequence: int = 7) -> dict:
    return crypto.seal_packet(CCSDSFrameHandler().build_telemetry_packet(sequence, PAYLOAD, 1e9))


# ---------------------------------------------------------------- phase 1: orbit and link


def test_builtin_tle_is_valid_and_dated_at_its_epoch():
    assert TLE["norad_id"] == 99542
    assert TLE["epoch_utc"] == "2026-10-26T12:00:00+00:00"
    for line in LEO_SAT_TLE[1:]:
        assert int(line[68]) == tle_checksum(line)


def test_a_corrupted_tle_is_refused():
    name, line1, line2 = LEO_SAT_TLE
    with pytest.raises(ValueError, match="checksum"):
        parse_tle("\n".join((name, line1, line2[:20] + "9" + line2[21:])))


def test_offline_loading_falls_back_to_the_builtin_set():
    assert EphemerisLoader().fetch_latest_tle(online=False) == EphemerisLoader.builtin()


def test_sgp4_state_matches_the_orbit():
    state = OrbitPropagator(TLE).propagate_eci_state(TLE["epoch_unix"])
    radius = math.dist(state["position_eci_km"], (0.0, 0.0, 0.0))
    speed = math.dist(state["velocity_eci_km_s"], (0.0, 0.0, 0.0))

    assert state["frame"] == "TEME"
    assert 6378.137 + 520.0 < radius < 6378.137 + 570.0
    assert speed == pytest.approx(7.59, abs=0.05)


def test_free_space_loss_at_the_mask_range():
    # FSPL = 20 log10(4 pi d f / c) at 2470 km and 8477.8 MHz.
    assert LinkBudgetCalculator().free_space_loss_db(2470.0) == pytest.approx(178.86, abs=0.01)
    assert air_mass(90.0) == pytest.approx(1.0, abs=1e-3)
    assert air_mass(2.0) > 15.0


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


def test_the_validator_refuses_an_unknown_vector(twin, first_pass):
    with pytest.raises(ValueError):
        twin.run_simulation_tick(first_pass["tca_unix"], "JAMMING")


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

    assert client.get("/health").json()["satellite"] == "LEO-SAT-542"
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
    assert client.get("/audit/verify").json()["intact"]


def test_dashboard_runs_a_tick(tmp_path, monkeypatch):
    pytest.importorskip("streamlit")
    from streamlit.testing.v1 import AppTest

    monkeypatch.setenv("GROUNDLINK_AUDIT_LOG", str(tmp_path / "audit.jsonl"))
    app = AppTest.from_file("../digital_twin/dashboard_ui.py", default_timeout=120).run()
    assert not app.exception

    app.sidebar.selectbox[0].set_value("DELAY_SPOOFING_MEACONING")
    app.sidebar.button[0].click().run()
    assert not app.exception
    labels = {metric.label: metric.value for metric in app.metric}
    assert labels["Final decision"] == "REJECTED"
    assert labels["Dominant residual"] == "slant_range_km"
