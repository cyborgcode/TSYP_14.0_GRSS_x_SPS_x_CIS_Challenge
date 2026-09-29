import type { Engine } from '../sim/engine';

/** Span shown around the Doppler-compensated carrier. */
export const SPAN_HZ = 10_000;
/** Physics gate on the Doppler residual, drawn as the acceptance band around the carrier. */
export const GATE_HZ = 60;

export interface Peak {
  hz: number;
  /** Power above the thermal noise floor. */
  db: number;
  rogue: boolean;
}

export interface SpectrumState {
  /** Noise floor above thermal noise: rises only under jamming. */
  floorDb: number;
  peaks: Peak[];
  link: boolean;
}

const MIN_SHARE = 0.08;

/**
 * What the GS-LAB receiver sees around the carrier right now. The genuine carrier sits
 * `snrDb` above the noise floor, so the spectrum always agrees with the SNR telemetry.
 */
export function spectrumState(engine: Engine): SpectrumState {
  const x = engine.current;
  const link = engine.pass.linkActive && x !== null;
  const kind = engine.attack?.kind;
  const env = engine.attackEnvelope;
  const jammed = kind === 'jam' && engine.route === 'LAB';
  const floorDb = jammed ? env * Math.max(0, 1.4 * engine.appliedPower - 3) : 0;
  const peaks: Peak[] = [];

  if (link && x) {
    const rogue = (kind === 'spoof' || kind === 'mimic') && env > 0.05;
    if (rogue) {
      // The genuine carrier is still there, pushed down by the stronger rogue signal.
      const genuineDb = x.snrModelDb + 10 * Math.log10(Math.max(MIN_SHARE, 1 - 0.7 * env));
      peaks.push({ hz: kind === 'spoof' ? 0 : x.dopplerHz, db: genuineDb, rogue: false });
      // The spoofer ignores Doppler; the mimic hides inside the ±60 Hz gate.
      const rogueHz = kind === 'spoof' ? x.dopplerHz : 12 * Math.sin(engine.s * 3);
      peaks.push({ hz: rogueHz, db: x.snrDb, rogue: true });
    } else {
      peaks.push({ hz: x.dopplerHz, db: floorDb + x.snrDb, rogue: false });
    }
  }
  return { floorDb, peaks, link };
}

/**
 * Fills `out` with linear power per frequency bin: exponentially distributed noise (what a
 * spectrum analyser shows per bin) plus a narrow line for each carrier.
 */
export function renderSpectrum(state: SpectrumState, out: Float32Array) {
  const n = out.length;
  const binHz = SPAN_HZ / n;
  const floor = 10 ** (state.floorDb / 10);
  const sigma = Math.max(1.2, 45 / binHz);
  for (let i = 0; i < n; i++) out[i] = floor * -Math.log(1 - Math.random());
  for (const p of state.peaks) {
    const amp = 10 ** (p.db / 10);
    const c = (p.hz + SPAN_HZ / 2) / binHz - 0.5;
    const lo = Math.max(0, Math.floor(c - sigma * 4));
    const hi = Math.min(n - 1, Math.ceil(c + sigma * 4));
    for (let i = lo; i <= hi; i++) {
      const d = (i - c) / sigma;
      out[i] += amp * Math.exp(-0.5 * d * d);
    }
  }
}

/** Horizontal position of a frequency offset across a plot of width `w` starting at `x0`. */
export function xOfHz(hz: number, x0: number, w: number): number {
  return x0 + ((hz + SPAN_HZ / 2) / SPAN_HZ) * w;
}
