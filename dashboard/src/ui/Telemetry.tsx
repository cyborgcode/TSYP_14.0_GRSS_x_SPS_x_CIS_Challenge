import {
  CategoryScale,
  Chart,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  type ScriptableLineSegmentContext,
} from 'chart.js';
import { useEffect, useRef } from 'react';

import { useEngine, useEngineCtx } from '../engineContext';
import { HISTORY, axisFlag, type TelemetryPoint } from '../sim/engine';
import type { Sample } from '../sim/signals';
import { fmtDb } from './format';
import { Panel } from './Panel';
import { Spectrum } from './Spectrum';
import { COLORS, FONT_DATA } from './useCanvas';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale);

type Kind = 'carrier' | 'rssi';

interface Spec {
  title: string;
  subtitle: string;
  value: (x: Sample) => number;
  model: (x: Sample) => number;
  out: (p: TelemetryPoint) => boolean;
  format: (x: Sample) => string;
  tick: (v: number, span: number) => string;
  /** Fixed axis range, or null to follow the data. */
  range: [number, number] | null;
}

const SPECS: Record<Kind, Spec> = {
  carrier: {
    title: 'Carrier frequency',
    subtitle: 'measured vs orbit-predicted · MHz',
    value: (x) => x.carrierMHz,
    model: (x) => x.carrierModelMHz,
    out: (p) => axisFlag(p.physics, 'dopplerHz'),
    format: (x) => `${x.carrierMHz.toFixed(3)} MHz`,
    tick: (v, span) => v.toFixed(span < 1 ? 2 : 1),
    range: null,
  },
  rssi: {
    title: 'Carrier power',
    subtitle: 'decoded carrier vs link budget · dBm',
    value: (x) => x.rssiDbm,
    model: (x) => x.rssiModelDbm,
    out: (p) => Boolean(p.x && (axisFlag(p.physics, 'rssiDb') || p.physics?.noFrames)),
    format: (x) => `${x.rssiDbm.toFixed(1)} dBm`,
    tick: (v) => `${Math.round(v)}`,
    range: [-105, -60],
  },
};

const REFRESH_MS = 100;

/** Chart.js stream of one telemetry channel, redrawn at 10 Hz while it is on screen. */
function LiveChart({ kind }: { kind: Kind }) {
  const { engine } = useEngineCtx();
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const spec = SPECS[kind];
    const measured: (number | null)[] = new Array(HISTORY).fill(null);
    const model: (number | null)[] = new Array(HISTORY).fill(null);
    const outFlags: boolean[] = new Array(HISTORY).fill(false);
    let last = -1;

    const chart = new Chart(el, {
      type: 'line',
      data: {
        labels: Array.from({ length: HISTORY }, (_, i) => i),
        datasets: [
          {
            data: model,
            borderColor: 'rgba(236, 242, 248, 0.45)',
            borderDash: [6, 5],
            borderWidth: 1.2,
            pointRadius: 0,
            spanGaps: false,
          },
          {
            data: measured,
            borderColor: COLORS.accent,
            borderWidth: 1.8,
            tension: 0.25,
            spanGaps: false,
            pointRadius: (c) => (c.dataIndex === last ? 3.5 : 0),
            pointBackgroundColor: (c) => (outFlags[c.dataIndex] ? COLORS.bad : COLORS.accent),
            pointBorderWidth: 0,
            segment: {
              borderColor: (c: ScriptableLineSegmentContext) =>
                outFlags[c.p0DataIndex] || outFlags[c.p1DataIndex] ? COLORS.bad : COLORS.accent,
            },
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        events: [],
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: {
            min: spec.range?.[0],
            max: spec.range?.[1],
            border: { display: false },
            grid: { color: COLORS.line },
            ticks: {
              color: COLORS.text2,
              font: { family: FONT_DATA, size: 11, weight: 600 },
              maxTicksLimit: 5,
              callback(v) {
                // More decimals when the axis spans little, so ticks never repeat.
                return spec.tick(Number(v), this.max - this.min);
              },
            },
          },
        },
      },
    });

    const update = () => {
      const history = engine.history;
      const offset = HISTORY - history.length;
      measured.fill(null);
      model.fill(null);
      outFlags.fill(false);
      let lo = Infinity;
      let hi = -Infinity;
      history.forEach((p, i) => {
        if (!p.x) return;
        const k = i + offset;
        const v = spec.value(p.x);
        const m = spec.model(p.x);
        measured[k] = v;
        model[k] = m;
        outFlags[k] = spec.out(p);
        lo = Math.min(lo, v, m);
        hi = Math.max(hi, v, m);
      });
      last = history[history.length - 1]?.x ? HISTORY - 1 : -1;
      if (!spec.range && Number.isFinite(lo)) {
        const pad = Math.max(0.15, (hi - lo) * 0.1);
        const y = chart.options.scales?.y;
        if (y) {
          y.min = lo - pad;
          y.max = hi + pad;
        }
      }
      chart.update('none');
    };

    let visible = true;
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io?.observe(el);
    update();
    const id = window.setInterval(() => {
      if (visible && !document.hidden) update();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(id);
      io?.disconnect();
      chart.destroy();
    };
  }, [engine, kind]);

  return (
    <div className="chart__box">
      <canvas ref={canvas} role="img" aria-label={`${SPECS[kind].title} chart`} />
    </div>
  );
}

function ChartBlock({ kind }: { kind: Kind }) {
  const engine = useEngine(10);
  const spec = SPECS[kind];
  const x = engine.current;
  const out = Boolean(x && spec.out({ s: engine.s, x, physics: engine.physics }));
  return (
    <div className={`chart ${out ? 'chart--out' : ''}`}>
      <div className="chart__head">
        <div>
          <div className="chart__title">{spec.title}</div>
          <div className="chart__subtitle">{spec.subtitle}</div>
        </div>
        <div className="chart__value" aria-live="off">
          {x ? spec.format(x) : 'LOS'}
        </div>
      </div>
      <LiveChart kind={kind} />
    </div>
  );
}

function SpectrumBlock() {
  const engine = useEngine(10);
  const x = engine.current;
  const link = engine.pass.linkActive && x !== null;
  const jammed = engine.attack?.kind === 'jam' && engine.attackEnvelope > 0.2;
  return (
    <div className={`chart ${jammed ? 'chart--out' : ''}`}>
      <div className="chart__head">
        <div>
          <div className="chart__title">Received spectrum</div>
          <div className="chart__subtitle">amplitude vs frequency</div>
        </div>
        <div className="chart__value" aria-live="off">
          {link && x ? fmtDb(x.snrDb) : 'LOS'}
        </div>
      </div>
      <div className="chart__box">
        <Spectrum />
      </div>
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
        <ChartBlock kind="carrier" />
        <ChartBlock kind="rssi" />
        <SpectrumBlock />
      </div>
    </Panel>
  );
}
