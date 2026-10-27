import { twoline2satrec } from 'satellite.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PASS_S,
  REFERENCE_PROFILE,
  SCENE_ORBIT_RADIUS,
  passAt,
  passProfile,
  sceneTiltFor,
  setPassProfile,
} from '../src/sim/geometry';
import {
  LIVE_NORAD_ID,
  findPass,
  isValidTle,
  loadPassProfile,
  passProfileFor,
  tleChecksum,
  type TleRecord,
} from '../src/sim/orbit';

// LEO-SAT, the digital twin's built-in element set (digital_twin/ephemeris_loader.py), so the
// browser's SGP4 passes can be checked against the Python twin's.
const LEO_SAT: TleRecord = {
  name: 'LEO-SAT-542',
  noradId: 99542,
  line1: '1 99542U 26299A   26299.50000000  .00001000  00000-0  45000-4 0  9994',
  line2: '2 99542  97.5400 299.0000 0001000  90.0000 270.0000 15.07841879    16',
  fetchedUtc: '2026-10-26T12:00:00.000Z',
};
const EPOCH_MS = Date.UTC(2026, 9, 26, 12);
// What /api/tle answers for TerraSAR-X: LEO-SAT's elements under the live catalogue number.
const relabel = (line: string) => {
  const swapped = line.replace('99542', String(LIVE_NORAD_ID)).slice(0, 68);
  return swapped + tleChecksum(swapped);
};
const LIVE: TleRecord = {
  ...LEO_SAT,
  name: 'TERRASAR-X',
  noradId: LIVE_NORAD_ID,
  line1: relabel(LEO_SAT.line1),
  line2: relabel(LEO_SAT.line2),
};

const serve = (body: unknown, ok = true) =>
  (async () => new Response(JSON.stringify(body), { status: ok ? 200 : 502 })) as typeof fetch;
const unreachable = (async () => {
  throw new TypeError('Failed to fetch');
}) as typeof fetch;

beforeEach(() => window.localStorage.clear());
afterEach(() => setPassProfile(REFERENCE_PROFILE));

describe('SGP4 passes over Zaghouan', () => {
  // Python twin, horizon to horizon: 15:17:16.1 → 15:26:50.5 UTC, culmination 11.656° at az
  // 66.4°, 1703.9 km; then 16:50:18.1 → 17:02:09.4, 44.01° at az 261.0°, 756.6 km.
  it('finds the same passes as the Python digital twin', () => {
    const satrec = twoline2satrec(LEO_SAT.line1, LEO_SAT.line2);
    const first = findPass(satrec, EPOCH_MS)!;
    expect(first.aosMs / 1000).toBeCloseTo(Date.UTC(2026, 9, 26, 15, 17, 16.1) / 1000, -0.5);
    expect(first.losMs / 1000).toBeCloseTo(Date.UTC(2026, 9, 26, 15, 26, 50.5) / 1000, -0.5);

    const low = passProfileFor(LEO_SAT, EPOCH_MS, 'celestrak')!;
    expect(low.maxElevationDeg).toBeCloseTo(11.656, 1);
    expect(low.culminationAzDeg).toBeCloseTo(66.4, 0);
    expect(low.realPassS).toBeCloseTo(574.4, -0.5);

    const high = passProfileFor(LEO_SAT, first.losMs + 60_000, 'celestrak')!;
    expect(high.maxElevationDeg).toBeCloseTo(44.01, 1);
    expect(high.culminationAzDeg).toBeCloseTo(261.0, 0);
    const culmination = high.at(0.5);
    expect(culmination.rangeKm).toBeGreaterThan(756);
    expect(culmination.rangeKm).toBeLessThan(760);
  });

  it('samples a pass from horizon to horizon, approaching then receding', () => {
    const p = passProfileFor(LEO_SAT, EPOCH_MS + 4 * 3_600_000, 'celestrak')!;
    expect(p.at(0).elevationDeg).toBeCloseTo(0, 1);
    expect(p.at(1).elevationDeg).toBeCloseTo(0, 1);
    expect(p.at(0.02).dopplerHz).toBeGreaterThan(150e3);
    expect(p.at(0.98).dopplerHz).toBeLessThan(-150e3);
    expect(p.at(0).rangeKm).toBeGreaterThan(2500);
    expect(p.altitudeKm).toBeGreaterThan(530);
    expect(p.altitudeKm).toBeLessThan(550);
  });

  it('skips passes lower than 10 degrees', () => {
    const satrec = twoline2satrec(LEO_SAT.line1, LEO_SAT.line2);
    let from = EPOCH_MS;
    for (let i = 0; i < 6; i++) {
      const p = passProfileFor(LEO_SAT, from, 'celestrak')!;
      expect(p.maxElevationDeg).toBeGreaterThanOrEqual(10);
      from = findPass(satrec, from)!.losMs + 60_000;
    }
  });

  it('tilts the scene orbit so the scene pass culminates as high as the real one', () => {
    expect(sceneTiltFor(90)).toBeCloseTo(0, 3);
    for (const el of [10, 25, 44, 70]) {
      const tilt = (sceneTiltFor(el) * Math.PI) / 180;
      const scene = Math.atan2(
        SCENE_ORBIT_RADIUS * Math.cos(tilt) - 1,
        SCENE_ORBIT_RADIUS * Math.sin(tilt),
      );
      expect((scene * 180) / Math.PI).toBeCloseTo(el, 3);
    }
  });

  it('replays the live pass through the testbed', () => {
    const p = passProfileFor(LEO_SAT, EPOCH_MS + 4 * 3_600_000, 'celestrak')!;
    setPassProfile(p);
    expect(passProfile()).toBe(p);
    expect(passAt(PASS_S / 2).elevationDeg).toBeCloseTo(p.maxElevationDeg, 0);
    expect(passAt(PASS_S / 2).rangeKm).toBeCloseTo(p.at(0.5).rangeKm, 3);
  });
});

describe('loading the live orbit', () => {
  it('validates element sets', () => {
    expect(isValidTle(LIVE)).toBe(true);
    expect(isValidTle(LEO_SAT)).toBe(false); // another satellite
    expect(isValidTle({ ...LIVE, line2: LIVE.line2.slice(0, 68) + '0' })).toBe(
      tleChecksum(LIVE.line2) === 0,
    );
    expect(isValidTle(null)).toBe(false);
  });

  it('flies the live download and keeps it for offline use', async () => {
    const live = await loadPassProfile(EPOCH_MS, serve(LIVE));
    expect(live.source).toBe('celestrak');
    expect(live.satName).toBe('TERRASAR-X');
    expect(live.noradId).toBe(LIVE_NORAD_ID);

    const offline = await loadPassProfile(EPOCH_MS, unreachable);
    expect(offline.source).toBe('cache');
    expect(offline.aosMs).toBe(live.aosMs);
  });

  it('falls back to the reference pass with no download and no cache', async () => {
    expect(await loadPassProfile(EPOCH_MS, unreachable)).toBe(REFERENCE_PROFILE);
    expect(await loadPassProfile(EPOCH_MS, serve({ error: 'CelesTrak down' }, false))).toBe(
      REFERENCE_PROFILE,
    );
    expect(await loadPassProfile(EPOCH_MS, serve(LEO_SAT))).toBe(REFERENCE_PROFILE);
  });

  it('stays on the reference pass in tests unless a fetcher is given', async () => {
    expect(await loadPassProfile()).toBe(REFERENCE_PROFILE);
  });
});
