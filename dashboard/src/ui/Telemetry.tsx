import { useEngine, useEngineCtx } from '../engineContext';
import { HISTORY, type TelemetryPoint } from '../sim/engine';
import { symlog } from '../sim/noise';
import { GATES } from '../sim/signals';
import { fmtDb, fmtHz, fmtUs } from './format';
import { Panel } from './Panel';
import { COLORS, FONT_DATA, FONT_UI, hatch, useCanvasLoop } from './useCanvas';

type Kind = 'doppler' | 'snr' | 'timing';

interface Spec {
  title: string;
  subtitle: string;
  /** Value to plot (already on the axis scale) or null for "no frames". */
  y: (p: TelemetryPoint) => number | null | undefined;
  out: (p: TelemetryPoint) => boolean;
  range: [number, number];
  gate?: number;
  ticks: { v: number; label: string }[];
  model?: boolean;
}

const SPECS: Record<Kind, Spec> = {
  doppler: {
    title: 'Doppler residual',
    subtitle: 'measured − orbit model · log scale',
    y: (p) => (p.x ? symlog(p.x.dopplerHz, 10) : undefined),
    out: (p) => Boolean(p.gates?.doppler),
    range: [-2.6, 2.6],
    gate: symlog(GATES.dopplerHz, 10),
    ticks: [
      { v: symlog(1000, 10), label: '+1k' },
      { v: symlog(60, 10), label: '+60' },
      { v: 0, label: '0' },
      { v: symlog(-60, 10), label: '−60' },
      { v: symlog(-1000, 10), label: '−1k' },
    ],
  },
  snr: {
    title: 'SNR vs link budget',
    subtitle: 'measured vs elevation model',
    y: (p) => (p.x ? p.x.snrDb : undefined),
    out: (p) => Boolean(p.gates?.snr),
    range: [-2, 30],
    ticks: [
      { v: 30, label: '30' },
      { v: 20, label: '20' },
      { v: 10, label: '10' },
      { v: 0, label: '0' },
    ],
    model: true,
  },
  timing: {
    title: 'Timing skew',
    subtitle: 'vs GNSS-disciplined clock · log scale',
    y: (p) => (p.x ? (p.x.timingUs === null ? null : symlog(p.x.timingUs, 1)) : undefined),
    out: (p) => Boolean(p.gates?.timing || p.gates?.noFrames),
    range: [-3.3, 3.3],
    gate: symlog(GATES.timingUs, 1),
    ticks: [
      { v: symlog(1000, 1), label: '+1 ms' },
      { v: symlog(8, 1), label: '+8' },
      { v: 0, label: '0' },
      { v: symlog(-8, 1), label: '−8' },
    ],
  },
};

function Chart({ kind }: { kind: Kind }) {
  const { engine } = useEngineCtx();
  const spec = SPECS[kind];

  const ref = useCanvasLoop((ctx, w, h) => {
    const left = 40;
    const right = 8;
    const top = 6;
    const bottom = 6;
    const pw = w - left - right;
    const ph = h - top - bottom;
    const [lo, hi] = spec.range;
    const Y = (v: number) => top + (1 - (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * ph;
    const X = (i: number) => left + (i / (HISTORY - 1)) * pw;

    // Grid and ticks.
    ctx.font = `600 11px ${FONT_DATA}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of spec.ticks) {
      const y = Y(t.v);
      ctx.strokeStyle = COLORS.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(w - right, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.text2;
      ctx.fillText(t.label, left - 6, y);
    }

    const history = engine.history;
    const offset = HISTORY - history.length;

    // Acceptance region between the detection gates.
    if (spec.gate !== undefined) {
      const g = spec.gate;
      ctx.fillStyle = 'rgba(76, 201, 240, 0.06)';
      ctx.fillRect(left, Y(g), pw, Y(-g) - Y(g));
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = COLORS.text2;
      for (const v of [g, -g]) {
        ctx.beginPath();
        ctx.moveTo(left, Y(v));
        ctx.lineTo(w - right, Y(v));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = `500 11px ${FONT_UI}`;
      ctx.fillStyle = COLORS.text2;
      ctx.textAlign = 'left';
      ctx.fillText('detection gate', left + 6, Y(g) - 8);
    }

    // SNR model line and ±4 dB band.
    if (spec.model) {
      ctx.beginPath();
      let started = false;
      const upper: [number, number][] = [];
      const lower: [number, number][] = [];
      history.forEach((p, i) => {
        if (!p.x) return;
        upper.push([X(i + offset), Y(p.x.snrModelDb + GATES.snrBandDb)]);
        lower.push([X(i + offset), Y(p.x.snrModelDb - GATES.snrBandDb)]);
      });
      if (upper.length > 1) {
        ctx.fillStyle = 'rgba(76, 201, 240, 0.06)';
        ctx.beginPath();
        upper.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        [...lower].reverse().forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fill();
      }
      ctx.beginPath();
      history.forEach((p, i) => {
        if (!p.x) {
          started = false;
          return;
        }
        const x = X(i + offset);
        const y = Y(p.x.snrModelDb);
        if (started) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        started = true;
      });
      ctx.setLineDash([6, 5]);
      ctx.strokeStyle = 'rgba(236, 242, 248, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      const lastWithX = [...history].reverse().find((p) => p.x);
      if (lastWithX?.x) {
        ctx.font = `500 11px ${FONT_UI}`;
        ctx.fillStyle = 'rgba(236, 242, 248, 0.6)';
        ctx.textAlign = 'left';
        ctx.fillText('model', left + 6, Y(lastWithX.x.snrModelDb + GATES.snrBandDb) - 8);
      }
    }

    // Gaps: loss of signal between passes (grey), frames lost to jamming (amber hatch).
    let gapStart = -1;
    let gapKind: 'los' | 'lost' | null = null;
    const flushGap = (end: number) => {
      if (gapStart < 0 || !gapKind) return;
      const x0 = X(gapStart + offset);
      const x1 = X(end + offset);
      if (gapKind === 'lost') hatch(ctx, x0, top, Math.max(2, x1 - x0), ph, COLORS.warn);
      else {
        ctx.fillStyle = 'rgba(125, 142, 163, 0.08)';
        ctx.fillRect(x0, top, Math.max(2, x1 - x0), ph);
        if (x1 - x0 > 30) {
          ctx.fillStyle = COLORS.text2;
          ctx.font = `700 11px ${FONT_UI}`;
          ctx.textAlign = 'center';
          ctx.fillText('LOS', (x0 + x1) / 2, top + ph / 2);
        }
      }
      gapStart = -1;
      gapKind = null;
    };
    history.forEach((p, i) => {
      const kindHere: 'los' | 'lost' | null = !p.x
        ? 'los'
        : kind === 'timing' && p.x.timingUs === null
          ? 'lost'
          : null;
      if (kindHere !== gapKind) {
        flushGap(i);
        if (kindHere) {
          gapStart = i;
          gapKind = kindHere;
        }
      }
    });
    flushGap(history.length - 1);

    // Data line, red wherever it leaves the gate.
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    for (let i = 1; i < history.length; i++) {
      const a = history[i - 1];
      const b = history[i];
      const ya = spec.y(a);
      const yb = spec.y(b);
      if (ya == null || yb == null) continue;
      ctx.strokeStyle = spec.out(a) || spec.out(b) ? COLORS.bad : COLORS.accent;
      ctx.beginPath();
      ctx.moveTo(X(i - 1 + offset), Y(ya));
      ctx.lineTo(X(i + offset), Y(yb));
      ctx.stroke();
    }

    const last = history[history.length - 1];
    const yl = last ? spec.y(last) : null;
    if (last && yl != null) {
      const x = X(history.length - 1 + offset);
      const y = Y(yl);
      const color = spec.out(last) ? COLORS.bad : COLORS.accent;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 10);
      glow.addColorStop(0, `${color}aa`);
      glow.addColorStop(1, `${color}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(x - 10, y - 10, 20, 20);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  return (
    <canvas ref={ref} className="chart__canvas" role="img" aria-label={`${spec.title} chart`} />
  );
}

function ChartBlock({ kind }: { kind: Kind }) {
  const engine = useEngine(10);
  const spec = SPECS[kind];
  const x = engine.current;
  const g = engine.gates;
  let value = 'LOS';
  let out = false;
  if (x && g) {
    if (kind === 'doppler') {
      value = fmtHz(x.dopplerHz);
      out = g.doppler;
    } else if (kind === 'snr') {
      value = fmtDb(x.snrDb);
      out = g.snr;
    } else {
      value = fmtUs(x.timingUs);
      out = g.timing || g.noFrames;
    }
  }
  return (
    <div className={`chart ${out ? 'chart--out' : ''}`}>
      <div className="chart__head">
        <div>
          <div className="chart__title">{spec.title}</div>
          <div className="chart__subtitle">{spec.subtitle}</div>
        </div>
        <div className="chart__value" aria-live="off">
          {value}
        </div>
      </div>
      <Chart kind={kind} />
    </div>
  );
}

export function TelemetryPanel() {
  const engine = useEngine(4);
  const alert = engine.state === 'UNDER ATTACK';
  return (
    <Panel
      badge="2A"
      title="Physical-layer telemetry"
      tag="D3 · SPS"
      alert={alert}
      className="panel--telemetry"
    >
      <div className="charts">
        <ChartBlock kind="doppler" />
        <ChartBlock kind="snr" />
        <ChartBlock kind="timing" />
      </div>
    </Panel>
  );
}
