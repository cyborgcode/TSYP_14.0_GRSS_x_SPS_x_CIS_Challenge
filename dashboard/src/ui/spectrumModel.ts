import type { Engine } from '../sim/engine';
import { CARRIER_HZ } from '../sim/geometry';

/** Span shown around the orbit-predicted carrier: wide enough to catch the +14.2 MHz hijack. */
export const SPAN_HZ = 40e6;
/** Occupied bandwidth of the genuine QPSK downlink. */
export const CHANNEL_HZ = 6e6;
const ROGUE_WIDTH_HZ = 1.6e6;

export interface Peak {
  /** Centre offset from the predicted carrier. */
  hz: number;
  /** In-band power above the thermal noise floor. */
  db: number;
  widthHz: number;
  rogue: boolean;
}

export interface SpectrumState {
  /** Orbit-predicted carrier the receiver is tuned to, MHz. */
  centreMHz: number;
  /** Noise floor above thermal noise: rises only under jamming. */
  floorDb: number;
  peaks: Peak[];
  link: boolean;
}

const MIN_SHARE = 0.08;

/**
 * What the Zaghouan receiver sees around its tuned carrier right now. The genuine downlink sits
 * `snrDb` above the noise floor, so the spectrum always agrees with the RSSI telemetry.
 */
export function spectrumState(engine: Engine): SpectrumState {
  const x = engine.current;
  const link = engine.pass.linkActive && x !== null;
  const kind = engine.attack?.kind;
  const env = engine.attackEnvelope;
  const jammed = kind === 'jam' && engine.route === 'ZAG';
  const floorDb = jammed ? env * Math.max(0, 1.4 * engine.appliedPower - 3) : 0;
  const peaks: Peak[] = [];

  if (link && x) {
    const rogue = (kind === 'hijack' || kind === 'spoof') && env > 0.05;
    if (rogue) {
      // The genuine downlink is still there, pushed down by the stronger rogue signal.
      const genuineDb = x.snrModelDb + 10 * Math.log10(Math.max(MIN_SHARE, 1 - 0.7 * env));
      peaks.push({ hz: 0, db: genuineDb, widthHz: CHANNEL_HZ, rogue: false });
      if (kind === 'hijack') {
        // The measured carrier is the rogue one: its offset is the telemetry's Doppler residual.
        peaks.push({ hz: x.dopplerHz, db: x.snrDb, widthHz: ROGUE_WIDTH_HZ, rogue: true });
      } else {
        // Node 0x99A2 transmits on the same channel: spectrally indistinguishable.
        peaks.push({ hz: x.dopplerHz, db: x.snrDb - 1.5, widthHz: CHANNEL_HZ, rogue: true });
      }
    } else {
      peaks.push({ hz: x.dopplerHz, db: floorDb + x.snrDb, widthHz: CHANNEL_HZ, rogue: false });
    }
  }
  const centreMHz = x ? x.carrierModelMHz : CARRIER_HZ / 1e6;
  return { centreMHz, floorDb, peaks, link };
}

/** Flat-topped band shape with steep skirts, as a filtered QPSK signal shows on an analyser. */
function bandShape(offsetHz: number, widthHz: number): number {
  const u = (2 * offsetHz) / widthHz;
  return 1 / (1 + u ** 8);
}

/**
 * Fills `out` with linear power per frequency bin: exponentially distributed noise (what a
 * spectrum analyser shows per bin) plus each signal's band.
 */
export function renderSpectrum(state: SpectrumState, out: Float32Array) {
  const n = out.length;
  const binHz = SPAN_HZ / n;
  const floor = 10 ** (state.floorDb / 10);
  for (let i = 0; i < n; i++) out[i] = floor * -Math.log(1 - Math.random());
  for (const p of state.peaks) {
    const amp = 10 ** (p.db / 10);
    for (let i = 0; i < n; i++) {
      const hz = -SPAN_HZ / 2 + (i + 0.5) * binHz;
      const shape = bandShape(hz - p.hz, p.widthHz);
      // Signal power fluctuates bin to bin like the noise does, just less.
      if (shape > 1e-4) out[i] += amp * shape * (0.75 + 0.5 * Math.random());
    }
  }
}

/** Horizontal position of a frequency offset across a plot of width `w` starting at `x0`. */
export function xOfHz(hz: number, x0: number, w: number): number {
  return x0 + ((hz + SPAN_HZ / 2) / SPAN_HZ) * w;
}
