from dataclasses import replace

import pytest

from core.trust import GENESIS, ObservationLog, digest_payload

KEY = b"unit-test-key"


def build_log(n=6):
    log = ObservationLog(KEY)
    for i in range(n):
        log.append(float(i), {"cn0_db": 44.0 + i, "agc_db": 30.0})
    return log


def test_empty_key_is_rejected():
    with pytest.raises(ValueError):
        ObservationLog(b"")


def test_a_sealed_chain_verifies():
    log = build_log()

    assert len(log) == 6
    assert log.records[0].prev_digest == GENESIS
    assert log.verify() == (True, "")


def test_each_record_commits_to_its_predecessor():
    log = build_log()
    records = log.records

    assert all(records[i].prev_digest == records[i - 1].mac for i in range(1, len(records)))


def test_edited_payload_breaks_authentication():
    log = build_log()
    forged = list(log.records)
    forged[3] = replace(forged[3], payload_digest=digest_payload({"cn0_db": 0.0}))

    ok, reason = log.verify(forged)
    assert not ok
    assert "index 3" in reason


def test_reordering_is_detected():
    log = build_log()
    forged = list(log.records)
    forged[2], forged[3] = forged[3], forged[2]

    ok, reason = log.verify(forged)
    assert not ok
    assert "out of order" in reason


def test_dropping_a_record_breaks_the_chain():
    log = build_log()
    forged = [r for r in log.records if r.index != 2]

    ok, _ = log.verify(forged)
    assert not ok
