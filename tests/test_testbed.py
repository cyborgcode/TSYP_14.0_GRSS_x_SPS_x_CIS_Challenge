"""Tests for the testbed package: ingester, detector, trust anchor, zero trust, validator."""

import pytest

from testbed.detector import TelemetryDetector
from testbed.ingester import (
    HIJACK_OFFSET_MHZ,
    JAMMED_RSSI_DBM,
    NOMINAL_CARRIER_MHZ,
    ROGUE_NODE_TOKEN,
    TelemetryIngester,
    predicted_link,
)
from testbed.trust_anchor import GENESIS_PAYLOAD, TrustAnchorLedger
from testbed.validator import Pipeline, measure
from testbed.zero_trust import ZeroTrustPolicyEngine


@pytest.fixture(scope="module")
def pipe():
    return Pipeline(seed=7, n_train=1200)


def test_attack_signatures_match_the_dashboard():
    ing = TelemetryIngester(seed=1)
    for _ in range(20):
        p = ing.generate_packet("frequency_hijacking")
        carrier, _ = predicted_link(p["pass_phase"])
        assert abs(p["carrier_frequency_mhz"] - carrier - HIJACK_OFFSET_MHZ) < 0.4
    jam = ing.generate_packet("noise_jamming")
    assert abs(jam["rssi_dbm"] - JAMMED_RSSI_DBM) <= 0.5
    spoof = ing.generate_packet("stealth_spoofing")
    assert spoof["hw_token"] == ROGUE_NODE_TOKEN
    assert spoof["satellite_id"] == "LEO-SAT-542"
    assert abs(predicted_link(0.5)[0] - NOMINAL_CARRIER_MHZ) < 1e-9


def test_trust_anchor_accepts_genuine_and_rejects_forged_tampered_and_replayed():
    ing = TelemetryIngester(seed=2)
    ledger = TrustAnchorLedger(ing.key)
    genuine = ing.generate_packet("normal")
    assert ledger.authenticate(genuine) == (True, "AUTHENTIC")
    assert ledger.authenticate(genuine) == (False, "STALE_OR_REUSED_NONCE")

    tampered = dict(ing.generate_packet("normal"), payload="00" * 16)
    assert ledger.authenticate(tampered) == (False, "MAC_MISMATCH")
    assert ledger.authenticate(ing.generate_packet("stealth_spoofing"))[1] == "MAC_MISMATCH"
    assert ledger.authenticate(ing.generate_packet("frequency_hijacking"))[1] == "MAC_MISMATCH"
    # A jammed frame is degraded, not forged.
    assert ledger.authenticate(ing.generate_packet("noise_jamming"))[0] is True


def test_forged_frame_does_not_burn_a_genuine_nonce():
    ing = TelemetryIngester(seed=3)
    ledger = TrustAnchorLedger(ing.key)
    genuine = ing.generate_packet("normal")
    forged = dict(genuine, mac="0" * 64)
    assert ledger.authenticate(forged)[0] is False
    assert ledger.authenticate(genuine)[0] is True


def test_ledger_chain_from_genesis_detects_any_edit():
    ing = TelemetryIngester(seed=4)
    ledger = TrustAnchorLedger(ing.key)
    assert ledger.chain[0]["payload"] == GENESIS_PAYLOAD
    for mode in ("normal", "stealth_spoofing", "normal", "frequency_hijacking"):
        ledger.ingest(ing.generate_packet(mode))
    assert ledger.verify_chain()[0] is True

    ledger.chain[2]["payload"]["verdict"] = "AUTHENTIC"
    ok, msg = ledger.verify_chain()
    assert not ok and "index 2" in msg


def test_detector_never_reads_the_ground_truth_label(pipe):
    ing = TelemetryIngester(seed=5)
    detector = TelemetryDetector()
    detector.train_baseline([ing.generate_packet("normal") for _ in range(600)])
    twin = TelemetryDetector()
    twin.model, twin.is_trained = detector.model, True
    for mode in ("normal", "frequency_hijacking", "stealth_spoofing", "noise_jamming"):
        packet = ing.generate_packet(mode)
        unlabelled = {k: v for k, v in packet.items() if k != "attack_mode"}
        assert detector.evaluate_packet(packet) == twin.evaluate_packet(unlabelled)
        detector.accept(packet)
        twin.accept(unlabelled)


def test_zero_trust_denies_on_token_mismatch_even_with_a_clean_rf_profile(pipe):
    zta = ZeroTrustPolicyEngine()
    packet = pipe.ingester.generate_packet("stealth_spoofing")
    clean = {"anomaly": False}
    decision = zta.evaluate_access_request(packet, clean, (True, "AUTHENTIC"))
    assert decision["access_granted"] is False
    assert "0x99A2" in decision["reason"]

    genuine = pipe.ingester.generate_packet("normal")
    ok = zta.evaluate_access_request(genuine, clean, (True, "AUTHENTIC"))
    assert ok["policy_action"] == "ALLOW_STREAM"


def test_measured_pipeline_blocks_every_attack_with_a_low_false_alarm_rate():
    m = measure(seed=11, n_train=1200, n_nominal=900, bursts=10, burst_len=12)
    rates = m["rates"]
    assert rates["normal"]["denied"] < 0.05
    assert rates["normal"]["anchor"] == 0
    assert rates["frequency_hijacking"]["denied"] == 1
    assert rates["stealth_spoofing"]["anchor"] == 1
    assert rates["stealth_spoofing"]["denied"] == 1
    assert rates["noise_jamming"]["denied"] > 0.95
    assert all(v == 1 for v in m["packets_to_first_flag"].values())
    assert m["chain"]["intact"] and m["chain"]["tamper_detected"]
