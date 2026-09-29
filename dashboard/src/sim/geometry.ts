// Pass geometry for one EO satellite over the Zaghouan ground station.
//
// Physics uses the real orbit (542.8 km sun-synchronous LEO) at X-band; the 3D scene uses a
// stylised orbit radius so both bodies stay readable. The two are tied by central angle, so
// the satellite rises, culminates and sets in the scene exactly when the real pass does.

import { clamp } from './noise';

export const EARTH_RADIUS_KM = 6371;
export const ALTITUDE_KM = 542.8;
export const ORBIT_RADIUS_KM = EARTH_RADIUS_KM + ALTITUDE_KM;
const MU_KM3_S2 = 398_600.4418;
/** Kepler's third law for a circular orbit. */
export const ORBIT_PERIOD_S = 2 * Math.PI * Math.sqrt(ORBIT_RADIUS_KM ** 3 / MU_KM3_S2);
export const CARRIER_HZ = 8477.8e6; // X-band downlink
export const C_KM_S = 299_792.458;
/** Receiver noise floor in the channel: RSSI = noise floor + SNR. */
export const NOISE_FLOOR_DBM = -100;

/** Link-budget parameters (illustrative X-band EO downlink, 13 m class station). */
export const LINK = { eirpDbw: 18, lossesDb: 2, gOverTDbK: 31, bandwidthHz: 300e6 };

/** Scene orbit radius in Earth radii (stylised so the pass arc fits the horizon view). */
export const SCENE_ORBIT_RADIUS = 1.6;

/** Seconds of scene time for one horizon-to-horizon pass, and for the unseen remainder. */
export const PASS_S = 66;
export const HIDDEN_S = 3;
export const PERIOD_S = PASS_S + HIDDEN_S;

export const MASK_ELEVATION_DEG = 2;

const OMEGA = (2 * Math.PI) / ORBIT_PERIOD_S;
/** Central angle at which the real satellite crosses the station's horizon. */
export const HORIZON_ANGLE = Math.acos(EARTH_RADIUS_KM / ORBIT_RADIUS_KM);
const SCENE_HORIZON_ANGLE = Math.acos(1 / SCENE_ORBIT_RADIUS);

/** Real pass duration (s) and how much the scene compresses it. */
export const REAL_PASS_S = (2 * HORIZON_ANGLE) / OMEGA;
export const TIME_COMPRESSION = REAL_PASS_S / PASS_S;

export interface PassState {
  /** Central angle from the station, rad, negative while approaching. */
  centralAngle: number;
  /** Scene orbit angle, rad. */
  sceneAngle: number;
  elevationDeg: number;
  rangeKm: number;
  rangeRateKmS: number;
  dopplerHz: number;
  inView: boolean;
  /** Frames flow only above the elevation mask. */
  linkActive: boolean;
  /** Seconds into the current pass (0 at rise). */
  passT: number;
}

export function fsplDb(dKm: number, fMhz: number): number {
  return 20 * Math.log10(dKm) + 20 * Math.log10(fMhz) + 32.44;
}

/** Predicted SNR from the link budget at slant range d. */
export function snrPredDb(dKm: number): number {
  const cn0 = LINK.eirpDbw - fsplDb(dKm, CARRIER_HZ / 1e6) - LINK.lossesDb + LINK.gOverTDbK + 228.6;
  return cn0 - 10 * Math.log10(LINK.bandwidthHz);
}

function realFromCentralAngle(phi: number) {
  const r = EARTH_RADIUS_KM;
  const ro = ORBIT_RADIUS_KM;
  const rangeKm = Math.sqrt(r * r + ro * ro - 2 * r * ro * Math.cos(phi));
  const elevation = Math.atan2(ro * Math.cos(phi) - r, ro * Math.abs(Math.sin(phi)));
  const rangeRateKmS = (r * ro * Math.sin(phi) * OMEGA) / rangeKm;
  return {
    rangeKm,
    elevationDeg: (elevation * 180) / Math.PI,
    rangeRateKmS,
    dopplerHz: (-CARRIER_HZ * rangeRateKmS) / C_KM_S,
  };
}

/** Pass state at scene time t (seconds). */
export function passAt(t: number): PassState {
  const local = ((t % PERIOD_S) + PERIOD_S) % PERIOD_S;

  if (local < PASS_S) {
    const u = local / PASS_S;
    const phi = (u * 2 - 1) * HORIZON_ANGLE;
    const real = realFromCentralAngle(phi);
    return {
      centralAngle: phi,
      sceneAngle: (phi / HORIZON_ANGLE) * SCENE_HORIZON_ANGLE,
      ...real,
      inView: true,
      linkActive: real.elevationDeg >= MASK_ELEVATION_DEG,
      passT: local,
    };
  }

  // Below the horizon: sweep the rest of the orbit quickly, back to the next rise.
  const u = (local - PASS_S) / HIDDEN_S;
  const sceneAngle = SCENE_HORIZON_ANGLE + u * (2 * Math.PI - 2 * SCENE_HORIZON_ANGLE);
  return {
    centralAngle: Math.PI,
    sceneAngle,
    elevationDeg: -30,
    rangeKm: NaN,
    rangeRateKmS: NaN,
    dopplerHz: NaN,
    inView: false,
    linkActive: false,
    passT: local,
  };
}

/** Scene time offset that puts the satellite `secondsAfterAos` past the elevation mask. */
export function timeAfterAos(secondsAfterAos: number): number {
  // Solve for the pass fraction where elevation crosses the mask (monotonic on the rise).
  let lo = 0;
  let hi = PASS_S / 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (passAt(mid).elevationDeg < MASK_ELEVATION_DEG) lo = mid;
    else hi = mid;
  }
  return hi + secondsAfterAos;
}

/** Seconds from mask rise to mask set. */
export function linkWindowS(): number {
  return PASS_S - 2 * timeAfterAos(0);
}

export const elevationWeight = (elDeg: number): number => clamp((elDeg - 5) / 40);
