// How the site names the orbit it replays: live, cached or the reference pass.

import { ALTITUDE_KM, passProfile, timeCompression, type PassProfile } from '../sim/geometry';

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Viewport readout: which orbit, how high. */
export function orbitReadout(p: PassProfile = passProfile()): string {
  if (p.source === 'reference') return `${ALTITUDE_KM} km sun-synchronous LEO`;
  return `${p.satName} · ${Math.round(p.altitudeKm)} km SSO`;
}

/** Header chip when no demo runs. */
export function passChip(p: PassProfile = passProfile()): string {
  if (p.source === 'reference' || p.aosMs === null) return 'Emulated pass · standard scenario';
  const kind = p.source === 'celestrak' ? 'Live orbit' : 'Cached orbit';
  return `${kind} · pass ${hhmm(p.aosMs)} UTC`;
}

/** One sentence on where the orbit comes from, for the footer. */
export function orbitSource(p: PassProfile = passProfile()): string {
  if (p.source === 'reference' || p.aosMs === null || p.tleEpochMs === null) {
    return (
      'The orbit is the built-in reference: an overhead pass of a 542.8 km sun-synchronous ' +
      'orbit (the live CelesTrak element set could not be loaded).'
    );
  }
  const from =
    p.source === 'celestrak'
      ? "CelesTrak's latest element set"
      : 'the last CelesTrak element set this browser downloaded (offline)';
  return (
    `The orbit is live: ${p.satName} (NORAD ${p.noradId}) from ${from}, epoch ` +
    `${day(p.tleEpochMs)} ${hhmm(p.tleEpochMs)} UTC, propagated with SGP4 in your browser. ` +
    `Its next pass over Zaghouan rises ${day(p.aosMs)} ${hhmm(p.aosMs)} UTC and culminates at ` +
    `${p.maxElevationDeg.toFixed(1)}°; the testbed replays it ×${Math.round(timeCompression())}.`
  );
}
