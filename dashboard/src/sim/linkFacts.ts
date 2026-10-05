// Signal facts quoted on the site, derived from the link model so the text never drifts from it.
//
// The carrier is fixed; only the orbit's Doppler shift moves it. The received power follows the
// link budget at the current slant range, from the elevation mask to the zenith. Amplitudes are
// the peak voltage of that carrier across the receiver's 50 Ω input.

import {
  ALTITUDE_KM,
  CARRIER_HZ,
  MASK_ELEVATION_DEG,
  NOISE_FLOOR_DBM,
  REAL_PASS_S,
  fsplDb,
  passAt,
  snrPredDb,
  timeAfterAos,
} from './geometry';
import { FRAME_PERIOD_S } from './constants';
import { GATES, HIJACK_OFFSET_HZ, JAMMED_RSSI_DBM } from './signals';

/** Receiver input impedance used to turn power into voltage. */
export const RX_OHMS = 50;

/** Peak voltage (µV) of a sine carrier of `dbm` across the receiver input. */
export const peakMicrovolts = (dbm: number): number =>
  Math.sqrt(2 * 10 ** (dbm / 10) * 1e-3 * RX_OHMS) * 1e6;

/** RMS voltage (µV) of noise of `dbm` across the receiver input. */
export const rmsMicrovolts = (dbm: number): number =>
  Math.sqrt(10 ** (dbm / 10) * 1e-3 * RX_OHMS) * 1e6;

/** SNR lost when noise `aboveFloorDb` above the thermal floor is added to the channel. */
export const snrLossDb = (aboveFloorDb: number): number =>
  10 * Math.log10(1 + 10 ** (aboveFloorDb / 10));

const atMask = passAt(timeAfterAos(0));
const snrMin = snrPredDb(atMask.rangeKm);
const snrMax = snrPredDb(ALTITUDE_KM);

export const SIGNAL = {
  carrierMHz: CARRIER_HZ / 1e6,
  altitudeKm: ALTITUDE_KM,
  maskElevationDeg: MASK_ELEVATION_DEG,
  passMinutes: REAL_PASS_S / 60,
  /** Largest Doppler shift, at the elevation mask (positive on the rise, negative on the set). */
  dopplerMaxKHz: Math.abs(atMask.dopplerHz) / 1e3,
  slantRangeKm: { mask: atMask.rangeKm, zenith: ALTITUDE_KM },
  pathLossDb: {
    mask: fsplDb(atMask.rangeKm, CARRIER_HZ / 1e6),
    zenith: fsplDb(ALTITUDE_KM, CARRIER_HZ / 1e6),
  },
  /** Received carrier power: RSSI = noise floor + SNR. */
  rxDbm: { mask: NOISE_FLOOR_DBM + snrMin, zenith: NOISE_FLOOR_DBM + snrMax },
  snrDb: { mask: snrMin, zenith: snrMax },
  amplitudeUv: {
    mask: peakMicrovolts(NOISE_FLOOR_DBM + snrMin),
    zenith: peakMicrovolts(NOISE_FLOOR_DBM + snrMax),
  },
  noiseFloorDbm: NOISE_FLOOR_DBM,
  noiseUvRms: rmsMicrovolts(NOISE_FLOOR_DBM),
  modulation: 'QPSK',
  occupiedMHz: 6,
  framePeriodS: FRAME_PERIOD_S,
} as const;

/**
 * Natural variation against the orbit model on a clean pass (signals.ts with no attack), and
 * the physics gates that sit well outside it. tests/sim.test.ts re-measures these figures.
 */
export const NATURAL = {
  carrierHz: { sigma: 6.1, max: 19, gate: GATES.dopplerHz },
  powerDb: { sigma: 0.23, max: 0.82, gate: GATES.snrBandDb },
  timingUs: { sigma: 1.6, max: 4.5, gate: GATES.timingUs },
} as const;

/** The most noise an attacker can add before the SNR leaves the ±4 dB band. */
export const STEALTH = {
  maxSnrLossDb: GATES.snrBandDb,
  maxNoiseAboveFloorDb: 10 * Math.log10(10 ** (GATES.snrBandDb / 10) - 1),
  maxNoiseDbm: NOISE_FLOOR_DBM + 10 * Math.log10(10 ** (GATES.snrBandDb / 10) - 1),
} as const;

export const ATTACK_SIGNALS = {
  hijackMHz: (CARRIER_HZ + HIJACK_OFFSET_HZ) / 1e6,
  hijackOffsetMHz: HIJACK_OFFSET_HZ / 1e6,
  /** Default attack power: the hijacker's excess over the genuine carrier, and the jammer's. */
  defaultPowerDb: 9,
  jammedRssiDbm: JAMMED_RSSI_DBM,
  spoofPowerDropDb: 3.2,
} as const;
