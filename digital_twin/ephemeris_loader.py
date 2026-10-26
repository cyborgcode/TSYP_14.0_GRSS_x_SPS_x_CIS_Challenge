"""
ephemeris_loader.py
TSYP 14 Track 1: Secure Ground-Link Testbed
Digital twin, phase 1: two-line element sets (TLE) for the SGP4 propagator.

The built-in set describes LEO-SAT, the testbed's 542.8 km sun-synchronous satellite, so the
twin runs offline and gives the same passes on every run. `fetch_latest_tle(online=True)`
downloads the current set for any NORAD catalogue number from CelesTrak and falls back to
the built-in set when the network or the response fails.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

logger = logging.getLogger("EphemerisLoader")

CELESTRAK_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR={norad_id}&FORMAT=TLE"

LEO_SAT_NORAD_ID = 99542
#: LEO-SAT: 15.078 rev/day (542.8 km mean altitude), 97.54 deg sun-synchronous inclination,
#: epoch 2026-10-26 12:00 UTC.
LEO_SAT_TLE = (
    "LEO-SAT-542",
    "1 99542U 26299A   26299.50000000  .00001000  00000-0  45000-4 0  9994",
    "2 99542  97.5400 299.0000 0001000  90.0000 270.0000 15.07841879    16",
)


def tle_checksum(line: str) -> int:
    """Modulo-10 checksum of a TLE line: digits count their value, minus signs count 1."""
    return sum(int(c) if c.isdigit() else int(c == "-") for c in line[:68]) % 10


def validate_tle(line1: str, line2: str) -> None:
    """Raises ValueError unless both lines are well-formed and belong to one satellite."""
    for number, line in ((1, line1), (2, line2)):
        if len(line) != 69 or not line.startswith(f"{number} "):
            raise ValueError(f"TLE line {number} must be 69 characters starting with '{number} '")
        if not line[68].isdigit() or int(line[68]) != tle_checksum(line):
            raise ValueError(f"TLE line {number} fails its checksum")
    if line1[2:7] != line2[2:7]:
        raise ValueError("TLE lines carry different catalogue numbers")


def tle_epoch(line1: str) -> datetime:
    """Epoch of a TLE (two-digit year, then day of year with a fraction), in UTC."""
    year = int(line1[18:20])
    year += 2000 if year < 57 else 1900
    return datetime(year, 1, 1, tzinfo=UTC) + timedelta(days=float(line1[20:32]) - 1.0)


def parse_tle(text: str) -> dict:
    """Parses a two- or three-line element set (name line optional)."""
    lines = [line.rstrip() for line in text.strip().splitlines() if line.strip()]
    if len(lines) == 2:
        name, line1, line2 = "UNKNOWN", *lines
    elif len(lines) == 3:
        name, line1, line2 = lines[0].strip(), lines[1], lines[2]
    else:
        raise ValueError(f"expected 2 or 3 TLE lines, got {len(lines)}")
    validate_tle(line1, line2)
    epoch = tle_epoch(line1)
    return {
        "sat_name": name,
        "norad_id": int(line1[2:7]),
        "line1": line1,
        "line2": line2,
        "epoch_utc": epoch.isoformat(),
        "epoch_unix": epoch.timestamp(),
    }


class EphemerisLoader:
    def __init__(self, target_sat_id: int = LEO_SAT_NORAD_ID, timeout_s: float = 5.0):
        self.target_sat_id = target_sat_id
        self.timeout_s = timeout_s
        self.celestrak_url = CELESTRAK_URL.format(norad_id=target_sat_id)

    def fetch_latest_tle(self, online: bool = False) -> dict:
        """The element set for the propagator: CelesTrak when `online`, else LEO-SAT."""
        if online:
            try:
                tle = self._download()
                logger.info("Loaded TLE for NORAD %s from CelesTrak", self.target_sat_id)
                return tle
            except (ImportError, OSError, ValueError) as exc:
                logger.warning("CelesTrak fetch failed (%s); using the built-in LEO-SAT set", exc)
        tle = self.builtin()
        logger.info("Loaded built-in TLE for %s (NORAD %s)", tle["sat_name"], tle["norad_id"])
        return tle

    @staticmethod
    def builtin() -> dict:
        return parse_tle("\n".join(LEO_SAT_TLE))

    def _download(self) -> dict:
        import requests  # optional dependency, needed only for live element sets

        response = requests.get(self.celestrak_url, timeout=self.timeout_s)
        response.raise_for_status()
        return parse_tle(response.text)
