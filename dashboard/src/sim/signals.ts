// Physical-layer telemetry: carrier frequency, RSSI, SNR vs link budget, timing skew and EVM.
// Residual shapes follow the standard-scenario generator; the SNR model comes from the real
// link budget at the current slant range, so it rises and falls with the pass.

import { CARRIER_HZ, NOISE_FLOOR_DBM } from './geometry';
import { clamp, smooth, sn } from './noise';

export type AttackKind = 'hijack' | 'spoof' | 'jam';

export interface Attack {
  kind: AttackKind;
  tTrigger: number;
  /** Response time (or natural end); Infinity until scheduled. */
  tResponse: number;
  power: (s: number) => number;
}

export const GATES = { dopplerHz: 60, snrBandDb: 4, timingUs: 8 } as const;

/** Offset of the rogue carrier injected by the frequency hijack. */
export const HIJACK_OFFSET_HZ = 14.2e6;
/** Half-width of the hijacker's frequency sweep around its offset. */
export const HIJACK_SWEEP_HZ = 0.35e6;
/** RSSI the jammed receiver settles at, at nominal jammer power. */
export const JAMMED_RSSI_DBM = -96.5;
const JAM_REFERENCE_POWER_DB = 9;

/** Attack envelope: ramps in 0.05–0.3 s after the trigger, out over 0.5 s after the response. */
export function envelope(a: Attack, s: number): number {
  return (
    smooth(a.tTrigger + 0.05, a.tTrigger + 0.3, s) * (1 - smooth(a.tResponse, a.tResponse + 0.5, s))
  );
}

export interface Sample {
  /** Measured carrier minus the orbit-predicted carrier. */
  dopplerHz: number;
  /** Absolute measured carrier frequency, MHz. */
  carrierMHz: number;
  /** Orbit-predicted carrier frequency (nominal carrier + predicted Doppler), MHz. */
  carrierModelMHz: number;
  snrDb: number;
  snrModelDb: number;
  /** Received signal strength of the locked carrier. */
  rssiDbm: number;
  rssiModelDbm: number;
  /** Microseconds, or null when no frames arrive. */
  timingUs: number | null;
  evmPct: number;
  evmModelPct: number;
}

export const evmFromSnr = (snrDb: number): number => 100 / Math.sqrt(10 ** (snrDb / 10));

export interface SignalContext {
  attacks: Attack[];
  /** Transient EVM burst used by the false-alarm moment (0..1). */
  falseAlarm: number;
  /** Doppler predicted from the orbit for this instant. */
  dopplerPredHz?: number;
}

export function sample(s: number, snrModelDb: number, ctx: SignalContext): Sample {
  let dop = 7 * Math.sin(s * 1.9) + 11 * sn(s * 2.4, 11) + 4 * sn(s * 9, 12);
  let snr = snrModelDb + 0.7 * sn(s * 2.6, 31) + 0.3 * sn(s * 11, 33);
  let timing: number | null = 2 * Math.sin(s * 2.3) + 2.4 * sn(s * 3, 21) + 0.8 * sn(s * 11, 24);
  let lost = false;
  let jamRssi: { weight: number; e: number } | null = null;

  for (const a of ctx.attacks) {
    const e = envelope(a, s);
    if (e === 0) continue;
    const p = a.power(s);
    switch (a.kind) {
      case 'hijack':
        // A rogue carrier sweeping around +14.2 MHz captures the receiver's lock.
        dop += e * (HIJACK_OFFSET_HZ + HIJACK_SWEEP_HZ * Math.sin(s * 9) + 40e3 * sn(s * 3, 13));
        snr += e * (p + 1.1 * sn(s * 5, 34));
        timing += e * (27 + 6 * sn(s * 6, 22));
        break;
      case 'spoof':
        // Stealth: stays on the Doppler track and inside the SNR band; only the crypto breaks.
        dop += e * 16 * sn(s * 5, 16);
        snr -= e * (3.2 + 0.4 * sn(s * 7, 36));
        timing += e * 4.2;
        break;
      case 'jam':
        dop += e * clamp((p - 5) / 5) * 720 * sn(s * 22, 15);
        snr -= e * Math.max(0, 1.4 * p - 3) + e * clamp((p - 5) / 5) * 1.5 * sn(s * 16, 35);
        if (s >= a.tTrigger && s < a.tResponse && p > 7) lost = true;
        jamRssi = { weight: e * clamp(p / JAM_REFERENCE_POWER_DB), e };
        break;
    }
  }

  const evmModelPct = evmFromSnr(snrModelDb);
  const evmPct =
    evmFromSnr(snr) * (1 + 0.04 * sn(s * 7, 41)) + ctx.falseAlarm * (7 + 2 * sn(s * 13, 42));

  const rssiModelDbm = NOISE_FLOOR_DBM + snrModelDb;
  let rssiDbm = NOISE_FLOOR_DBM + snr;
  if (jamRssi) {
    // The saturated front end loses the carrier: RSSI collapses towards the jammed level.
    const target = JAMMED_RSSI_DBM + 0.5 * sn(s * 6, 37);
    rssiDbm += (target - rssiDbm) * jamRssi.weight;
  }

  const predicted = ctx.dopplerPredHz ?? 0;
  return {
    dopplerHz: dop,
    carrierMHz: (CARRIER_HZ + predicted + dop) / 1e6,
    carrierModelMHz: (CARRIER_HZ + predicted) / 1e6,
    snrDb: snr,
    snrModelDb,
    rssiDbm,
    rssiModelDbm,
    timingUs: lost ? null : timing,
    evmPct,
    evmModelPct,
  };
}

export interface GateResult {
  doppler: boolean;
  snr: boolean;
  timing: boolean;
  noFrames: boolean;
  any: boolean;
}

export function checkGates(x: Sample): GateResult {
  const doppler = Math.abs(x.dopplerHz) > GATES.dopplerHz;
  const snr = Math.abs(x.snrDb - x.snrModelDb) > GATES.snrBandDb;
  const noFrames = x.timingUs === null;
  const timing = x.timingUs !== null && Math.abs(x.timingUs) > GATES.timingUs;
  return { doppler, snr, timing, noFrames, any: doppler || snr || timing || noFrames };
}
