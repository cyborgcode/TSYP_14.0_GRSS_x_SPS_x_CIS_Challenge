import { useRef } from 'react';

import { useEngine, useEngineCtx } from '../engineContext';
import type { DetectorId, Engine } from '../sim/engine';
import { FEATURES, FLAG_AT } from '../sim/aiModel';
import { AlertIcon, CheckIcon } from './icons';
import { Panel } from './Panel';
import { COLORS, FONT_DATA, useCanvasLoop } from './useCanvas';

const START = 150;
const SWEEP = 240;

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, START + from * SWEEP);
  const [x1, y1] = polar(cx, cy, r, START + to * SWEEP);
  const large = (to - from) * SWEEP > 180 ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

function zone(v: number): { word: string; tone: 'ok' | 'warn' | 'bad' } {
  if (v >= 0.8) return { word: 'CRITICAL', tone: 'bad' };
  if (v >= 0.55) return { word: 'ELEVATED', tone: 'warn' };
  return { word: 'NOMINAL', tone: 'ok' };
}

function Gauge({ label, value, id }: { label: string; value: number; id: string }) {
  const v = Math.max(0, Math.min(1, value));
  const { word, tone } = zone(v);
  const cx = 70;
  const cy = 70;
  const r = 54;
  const [nx, ny] = polar(cx, cy, r - 12, START + v * SWEEP);
  return (
    <div className={`gauge gauge--${tone}`}>
      <svg
        viewBox="0 0 140 118"
        className="gauge__svg"
        role="img"
        aria-label={`${label} ${v.toFixed(2)}, ${word}`}
      >
        <defs>
          <linearGradient id={`g-${id}`} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={COLORS.ok} />
            <stop offset="0.6" stopColor={COLORS.warn} />
            <stop offset="1" stopColor={COLORS.bad} />
          </linearGradient>
        </defs>
        <path d={arc(cx, cy, r, 0, 0.55)} className="gauge__zone" stroke={COLORS.ok} />
        <path d={arc(cx, cy, r, 0.55, 0.8)} className="gauge__zone" stroke={COLORS.warn} />
        <path d={arc(cx, cy, r, 0.8, 1)} className="gauge__zone" stroke={COLORS.bad} />
        {/* Fixed full-sweep path revealed by its dash length, so the arc always stays on the dial. */}
        <path
          d={arc(cx, cy, r, 0, 1)}
          pathLength={1}
          className="gauge__active"
          stroke={`url(#g-${id})`}
          style={{ strokeDasharray: `${v} 1`, opacity: v > 0.005 ? 1 : 0 }}
        />
        <line x1={cx} y1={cy} x2={nx} y2={ny} className="gauge__needle" />
        <circle cx={cx} cy={cy} r="4" className="gauge__hub" />
        <text x={cx} y={cy + 30} className="gauge__value">
          {v.toFixed(2)}
        </text>
      </svg>
      <div className="gauge__label">{label}</div>
      <div className={`gauge__state gauge__state--${tone}`}>{word}</div>
    </div>
  );
}

/** The digital twin's three tiers, in its order: data, statistical, physical. */
const TIERS: { id: DetectorId; n: number; name: string; engine: string }[] = [
  { id: 'TRUST', n: 1, name: 'Data layer', engine: 'HMAC · SHA-256' },
  { id: 'AI', n: 2, name: 'Statistical layer', engine: 'Isolation Forest' },
  { id: 'PHYSICS', n: 3, name: 'Physical layer', engine: 'χ² · kinematic' },
];

/** What each tier is looking at right now. */
function tierMetric(engine: Engine, id: DetectorId): string {
  switch (id) {
    case 'TRUST': {
      const last = engine.packets.find((p) => p.frame);
      if (!last) return 'no frame yet';
      return last.auth.ok ? 'tag ok · nonce fresh' : last.auth.reason.toLowerCase();
    }
    case 'AI':
      return `score ${engine.anomaly.toFixed(2)} / ${FLAG_AT.toFixed(2)}`;
    case 'PHYSICS': {
      const live = engine.physics;
      if (!live) return 'no link';
      if (live.noFrames) return 'carrier lost';
      const kin = engine.packets.find((p) => p.physics?.kinematic.available)?.physics?.kinematic;
      const chi = `χ² ${fmtChi(live.chi.chiSquare)} / ${live.chi.threshold.toFixed(1)}`;
      return kin ? `${chi} · ${kin.z < 0 ? '−' : '+'}${Math.abs(kin.z).toFixed(1)}σ` : chi;
    }
  }
}

const fmtChi = (v: number) => (v >= 1000 ? v.toExponential(1).replace('e+', 'e') : v.toFixed(1));

function TierRow({ tier }: { tier: (typeof TIERS)[number] }) {
  const engine = useEngine(10);
  const d = engine.detectors[tier.id];
  let status = 'PASS';
  let tone: 'ok' | 'bad' | 'warn' = 'ok';
  if (d.evaded && !d.flag) {
    status = 'PASS · EVADED';
    tone = 'warn';
  } else if (d.flag) {
    tone = tier.id === 'AI' ? 'warn' : 'bad';
    status =
      tier.id === 'AI'
        ? 'HOLD'
        : d.latencyMs !== null
          ? `REJECT · ${Math.round(d.latencyMs)} ms`
          : 'REJECT';
  }
  return (
    <div className={`tier tier--${tone}`} role="row">
      <span className="tier__n mono" aria-hidden="true">
        {tier.n}
      </span>
      <span className="tier__body" role="cell">
        <span className="tier__name">{tier.name}</span>
        <span className="tier__engine">{tier.engine}</span>
      </span>
      <span className="tier__metric mono" role="cell">
        {tierMetric(engine, tier.id)}
      </span>
      <span className="tier__status" role="cell">
        {tone === 'ok' ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
        {status}
      </span>
    </div>
  );
}

function FeatureGrid() {
  const { engine } = useEngineCtx();
  const cols = 20;
  const buffer = useRef<number[][]>([]);
  const lastPush = useRef(0);

  const ref = useCanvasLoop((ctx, w, h, t) => {
    if (t - lastPush.current > 0.12) {
      lastPush.current = t;
      const f = engine.features;
      buffer.current.push([f[0], f[1], f[2], f[3], f[4] * 10 + f[5] * 10]);
      if (buffer.current.length > cols) buffer.current.shift();
    }
    const rows = 5;
    const gap = 3;
    const cw = (w - gap * (cols - 1)) / cols;
    const ch = (h - gap * (rows - 1)) / rows;
    const scan = Math.floor((t * (engine.heavyBatch ? 30 : 10)) % cols);
    for (let c = 0; c < cols; c++) {
      const vec = buffer.current[c];
      for (let r = 0; r < rows; r++) {
        const v = vec ? vec[r] : 0;
        const x = c * (cw + gap);
        const y = r * (ch + gap);
        const hot = v > 4;
        const level = Math.min(1, v / 4);
        ctx.fillStyle = hot
          ? `rgba(248, 72, 94, ${0.5 + 0.4 * Math.min(1, v / 12)})`
          : `rgba(76, 201, 240, ${0.08 + 0.42 * level})`;
        ctx.fillRect(x, y, cw, ch);
      }
    }
    const sx = scan * (cw + gap);
    ctx.fillStyle = 'rgba(206, 230, 255, 0.18)';
    ctx.fillRect(sx - 1, 0, cw + 2, h);
    ctx.strokeStyle = 'rgba(206, 230, 255, 0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - 0.5, 0.5, cw + 1, h - 1);
    ctx.font = `600 11px ${FONT_DATA}`;
  }, 30);

  return (
    <canvas
      ref={ref}
      className="feature-grid"
      role="img"
      aria-label="Feature vectors being scored by the Isolation Forest"
    />
  );
}

export function ThreatMatrixPanel() {
  const engine = useEngine(10);
  const votes = engine.votes;
  const vote =
    votes >= 2
      ? { tone: 'bad', text: `${votes}/3 · ESCALATE` }
      : votes === 1
        ? { tone: 'warn', text: '1/3 · CHECKING' }
        : { tone: 'ok', text: '0/3 · NOMINAL' };
  const rate = engine.vectorsPerSecond;
  const pulse =
    engine.state === 'UNDER ATTACK' || engine.state === 'JAMMING' ? 4 : engine.heavyBatch ? 3 : 1;
  const segments = Math.round(engine.batchLoad * 20);
  const driver = engine.detectors.AI.flag ? FEATURES[engine.aiDriver] : null;
  return (
    <Panel
      badge="3"
      title="Three-tier threat matrix"
      tag="D4 · CIS"
      alert={engine.state === 'UNDER ATTACK'}
      className="panel--threat"
    >
      <div className="gauges">
        <Gauge id="anomaly" label="ANOMALY SCORE" value={engine.anomaly} />
        <Gauge id="spoof" label="SPOOF LIKELIHOOD" value={engine.spoofLikelihood} />
      </div>

      <div className="fusion">
        <div className="fusion__head">
          <span className="overline">Three-tier verification · digital twin</span>
          <span className={`vote vote--${vote.tone}`}>{vote.text}</span>
        </div>
        <div className="tiers" role="table" aria-label="The three verification tiers">
          {TIERS.map((t) => (
            <TierRow key={t.id} tier={t} />
          ))}
        </div>
        <div className="fusion__note">
          {driver
            ? `Statistical flag driven by ${driver}`
            : 'Data or physics rejects a frame; the forest alone holds it. Two tiers escalate.'}
        </div>
      </div>

      <div className="iforest">
        <div
          className="iforest__core"
          style={{ ['--pulse' as string]: `${1 / pulse}s` }}
          aria-hidden="true"
        >
          <span />
        </div>
        <div className="iforest__body">
          <div className="iforest__head">
            <span className="overline">
              Isolation Forest · {engine.ai.forest.nEstimators} trees
            </span>
            <span className="mono iforest__rate">
              {rate >= 1000 ? `${(rate / 1000).toFixed(1)}k` : Math.round(rate)} vectors/s
            </span>
          </div>
          <FeatureGrid />
          <div className="batch">
            <span className="overline">Batch load</span>
            <div className="batch__bar" aria-hidden="true">
              {Array.from({ length: 20 }, (_, i) => (
                <span
                  key={i}
                  className={`batch__seg ${i < segments ? (i >= 16 ? 'is-bad' : i >= 11 ? 'is-warn' : 'is-ok') : ''}`}
                />
              ))}
            </div>
            <span className="mono">{Math.round(engine.batchLoad * 100)}%</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
