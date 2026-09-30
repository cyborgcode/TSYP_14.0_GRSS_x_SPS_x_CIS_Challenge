import { useRef } from 'react';

import { useEngineCtx } from '../engineContext';
import { ROGUE_NODE, SATELLITE } from '../sim/copy';
import { MINUS } from './format';
import { CHANNEL_HZ, SPAN_HZ, renderSpectrum, spectrumState, xOfHz } from './spectrumModel';
import { COLORS, FONT_DATA, FONT_UI, useCanvasLoop } from './useCanvas';

const BINS = 320;
const DB_MIN = -6;
const DB_MAX = 36;
const TICKS = [0, 10, 20, 30];
/** Video averaging, as on a spectrum analyser: keeps the noise readable without hiding changes. */
const AVERAGE = 0.35;

/** Live received spectrum: amplitude (dB above thermal noise) against frequency in MHz. */
export function Spectrum({ className = 'chart__fill' }: { className?: string }) {
  const { engine } = useEngineCtx();
  const raw = useRef(new Float32Array(BINS));
  const avg = useRef<Float32Array | null>(null);

  const ref = useCanvasLoop((ctx, w, h) => {
    const left = 40;
    const right = 8;
    const top = 8;
    const bottom = 18;
    const pw = w - left - right;
    const ph = h - top - bottom;
    const Y = (db: number) =>
      top + (1 - (Math.max(DB_MIN, Math.min(DB_MAX, db)) - DB_MIN) / (DB_MAX - DB_MIN)) * ph;
    const X = (hz: number) => xOfHz(hz, left, pw);

    const state = spectrumState(engine);
    renderSpectrum(state, raw.current);
    if (!avg.current) avg.current = Float32Array.from(raw.current);
    const a = avg.current;
    for (let i = 0; i < BINS; i++) a[i] += AVERAGE * (raw.current[i] - a[i]);

    // Grid, dB ticks and frequency labels (absolute MHz around the tuned carrier).
    ctx.font = `600 11px ${FONT_DATA}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (const t of TICKS) {
      ctx.strokeStyle = COLORS.line;
      ctx.beginPath();
      ctx.moveTo(left, Y(t));
      ctx.lineTo(w - right, Y(t));
      ctx.stroke();
      ctx.fillStyle = COLORS.text2;
      ctx.fillText(`${t} dB`, left - 6, Y(t));
    }
    const half = SPAN_HZ / 2e6;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillText(`${(state.centreMHz - half).toFixed(1)}`, left, h);
    ctx.textAlign = 'center';
    ctx.fillText(`${state.centreMHz.toFixed(1)} MHz`, X(0), h);
    ctx.textAlign = 'right';
    ctx.fillText(`${(state.centreMHz + half).toFixed(1)}`, w - right, h);

    // Licensed downlink channel around the tuned carrier.
    const c0 = X(-CHANNEL_HZ / 2);
    const c1 = X(CHANNEL_HZ / 2);
    ctx.fillStyle = 'rgba(76, 201, 240, 0.07)';
    ctx.fillRect(c0, top, c1 - c0, ph);

    // Noise floor.
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = state.floorDb > 3 ? COLORS.warn : 'rgba(236, 242, 248, 0.35)';
    ctx.beginPath();
    ctx.moveTo(left, Y(state.floorDb));
    ctx.lineTo(w - right, Y(state.floorDb));
    ctx.stroke();
    ctx.setLineDash([]);

    // Trace with a soft fill underneath.
    const px = (i: number) => left + ((i + 0.5) / BINS) * pw;
    const py = (i: number) => Y(10 * Math.log10(a[i] + 1e-9));
    ctx.beginPath();
    ctx.moveTo(px(0), py(0));
    for (let i = 1; i < BINS; i++) ctx.lineTo(px(i), py(i));
    ctx.lineTo(px(BINS - 1), top + ph);
    ctx.lineTo(px(0), top + ph);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, top, 0, top + ph);
    fill.addColorStop(0, 'rgba(76, 201, 240, 0.28)');
    fill.addColorStop(1, 'rgba(76, 201, 240, 0.02)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(px(0), py(0));
    for (let i = 1; i < BINS; i++) ctx.lineTo(px(i), py(i));
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Signal markers.
    ctx.font = `600 11px ${FONT_UI}`;
    ctx.textBaseline = 'bottom';
    const spoof = engine.attack?.kind === 'spoof';
    for (const p of state.peaks) {
      const x = X(p.hz);
      const y = Y(p.db + 2) - 4;
      const color = p.rogue ? (spoof ? COLORS.warn : COLORS.bad) : COLORS.accent;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y - 6);
      ctx.lineTo(x + 4, y - 6);
      ctx.closePath();
      ctx.fill();
      const snr = p.db - state.floorDb;
      const label = p.rogue
        ? spoof
          ? `NODE ${ROGUE_NODE} · same channel`
          : `ROGUE-TX +${(p.hz / 1e6).toFixed(1)} MHz`
        : `${SATELLITE} ${snr >= 0 ? '+' : MINUS}${Math.abs(snr).toFixed(1)} dB`;
      const tw = ctx.measureText(label).width;
      // Lift the co-channel rogue label so it does not sit on the genuine one.
      const lift = p.rogue && spoof ? 16 : 0;
      ctx.textAlign = 'left';
      ctx.fillText(
        label,
        Math.max(left + 2, Math.min(w - right - tw - 2, x - tw / 2)),
        Math.max(top + 12, y - 8 - lift),
      );
    }

    // Status sits bottom-right, above the floor, clear of the carrier labels.
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'right';
    ctx.font = `600 11px ${FONT_UI}`;
    if (!state.link) {
      ctx.fillStyle = COLORS.text2;
      ctx.fillText('LOS · no carrier', w - right - 4, top + 14);
    } else if (state.floorDb > 3) {
      ctx.fillStyle = COLORS.warn;
      ctx.fillText(
        `noise floor +${state.floorDb.toFixed(1)} dB`,
        w - right - 4,
        Y(state.floorDb + 12),
      );
    }
  });

  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label={`Received spectrum, amplitude against frequency over ${SPAN_HZ / 1e6} MHz`}
    />
  );
}
