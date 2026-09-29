// Physical-layer telemetry: Doppler residual, SNR vs link budget, timing skew and EVM.
// Residual shapes follow the standard-scenario generator; the SNR model comes from the real
// link budget at the current slant range, so it rises and falls with the pass.

import { clamp, smooth, sn } from './noise';

export type AttackKind = 'spoof' | 'replay' | 'jam' | 'mimic';

export interface Attack {
  kind: AttackKind;
  tTrigger: number;
  /** Response time (or natural end); Infinity until scheduled. */
  tResponse: number;
  power: (s: number) => number;
}

export const GATES = { dopplerHz: 60, snrBandDb: 4, timingUs: 8 } as const;

/** Attack envelope: ramps in 0.05–0.3 s after the trigger, out over 0.5 s after the response. */
export function envelope(a: Attack, s: number): number {
  return (
    smooth(a.tTrigger + 0.05, a.tTrigger + 0.3, s) * (1 - smooth(a.tResponse, a.tResponse + 0.5, s))
  );
}

export interface Sample {
  dopplerHz: number;
  snrDb: number;
  snrModelDb: number;
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
}

export function sample(s: number, snrModelDb: number, ctx: SignalContext): Sample {
  let dop = 7 * Math.sin(s * 1.9) + 11 * sn(s * 2.4, 11) + 4 * sn(s * 9, 12);
  let snr = snrModelDb + 0.7 * sn(s * 2.6, 31) + 0.3 * sn(s * 11, 33);
  let timing: number | null = 2 * Math.sin(s * 2.3) + 2.4 * sn(s * 3, 21) + 0.8 * sn(s * 11, 24);
  let lost = false;

  for (const a of ctx.attacks) {
    const e = envelope(a, s);
    if (e === 0) continue;
    const p = a.power(s);
    switch (a.kind) {
      case 'spoof':
        dop += e * (-1650 - 220 * sn(s * 3, 13));
        snr += e * (p + 1.1 * sn(s * 5, 34));
        timing += e * (27 + 6 * sn(s * 6, 22));
        break;
      case 'replay':
        dop += e * (380 * Math.sin((2 * Math.PI * (s - a.tTrigger)) / 1.3) + 110 * sn(s * 4, 14));
        snr += e * 0.8;
        timing += e * (850 + 60 * sn(s * 3, 23));
        break;
      case 'jam':
        dop += e * clamp((p - 5) / 5) * 720 * sn(s * 22, 15);
        snr -= e * Math.max(0, 1.4 * p - 3) + e * clamp((p - 5) / 5) * 1.5 * sn(s * 16, 35);
        if (s >= a.tTrigger && s < a.tResponse && p > 7) lost = true;
        break;
      case 'mimic':
        dop += e * 16 * sn(s * 5, 16);
        snr += e * 2.6;
        timing += e * 4.2;
        break;
    }
  }

  const evmModelPct = evmFromSnr(snrModelDb);
  const evmPct =
    evmFromSnr(snr) * (1 + 0.04 * sn(s * 7, 41)) + ctx.falseAlarm * (7 + 2 * sn(s * 13, 42));

  return {
    dopplerHz: dop,
    snrDb: snr,
    snrModelDb,
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
