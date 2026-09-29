import { lazy, Suspense } from 'react';

import { useEngine, useEngineCtx, usePrefersReducedMotion } from '../engineContext';
import { fmtHz, MINUS } from './format';
import { FocusOverlay } from './FocusOverlay';
import { AlertIcon, ArrowIcon, CheckIcon, CubeIcon, MouseIcon } from './icons';
import { Panel } from './Panel';

const Scene = lazy(() => import('../three/Scene'));

function Readout({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'bad' | 'warn' | 'ok';
}) {
  return (
    <div className="readout">
      <span className="overline">{label}</span>
      <span className={`readout__value ${tone ? `readout__value--${tone}` : ''}`}>{value}</span>
    </div>
  );
}

function Hud() {
  const engine = useEngine(8);
  const { focus } = useEngineCtx();
  const pass = engine.pass;
  const relayAlert = engine.attack && engine.attack.kind !== 'jam' && engine.attackEnvelope > 0.2;
  return (
    <>
      <div className="hud hud--tl">
        <Readout label="Segment" value="Ground link · Track 1" />
        <Readout label="Orbit" value="786 km sun-synchronous · pass model" />
      </div>
      <div className="hud hud--tr">
        <Readout
          label="Relay links"
          value={relayAlert ? '14/15 trusted' : '15/15 trusted'}
          tone={relayAlert ? 'bad' : undefined}
        />
        <Readout label="Tracking" value="12 stations · S2A" />
      </div>
      {focus === 'overview' && (
        <div className="hud hud--bottom">
          <div className="hud__stats mono">
            <span>
              <b>ELEV</b> {pass.inView ? `${pass.elevationDeg.toFixed(1)}°` : 'LOS'}
            </span>
            <span>
              <b>RANGE</b>{' '}
              {pass.inView ? `${Math.round(pass.rangeKm).toLocaleString('en-US')} km` : '—'}
            </span>
            <span>
              <b>RANGE RATE</b>{' '}
              {pass.inView
                ? `${pass.rangeRateKmS < 0 ? MINUS : '+'}${Math.abs(pass.rangeRateKmS).toFixed(2)} km/s`
                : '—'}
            </span>
            <span>
              <b>DOPPLER</b> {pass.inView ? fmtHz(pass.dopplerHz) : '—'}
            </span>
          </div>
          <div className="hud__hint">
            <MouseIcon size={14} /> Drag to orbit · scroll to zoom · click the satellite or the
            station
          </div>
        </div>
      )}
      <div className="callouts" aria-live="polite">
        {engine.callouts.map((c) => (
          <div key={c.id} className={`callout callout--${c.tone}`}>
            <span className="callout__dot" />
            <div>
              <div className="callout__text">{c.text}</div>
              {c.sub && <div className="callout__sub">{c.sub}</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

const NODES = [
  'Sensor',
  'Downlink',
  'Ground station',
  'L0 decode',
  'Provenance gate',
  'Analyst',
] as const;

export function ChainStrip() {
  const engine = useEngine(8);
  const kind = engine.attack?.kind;
  const active = engine.attackEnvelope > 0.2;
  const attack = active && kind && kind !== 'jam';
  const jam = active && kind === 'jam' && engine.route === 'LAB';
  const link = engine.pass.linkActive;

  const linkState = (i: number): 'ok' | 'bad' | 'starved' | 'blocked' | 'idle' => {
    if (!link) return 'idle';
    if (attack && i >= 1 && i <= 3) return 'bad';
    if (attack && i === 4) return 'blocked';
    if (jam && i >= 1 && i <= 4) return 'starved';
    return 'ok';
  };
  const nodeTone = (name: (typeof NODES)[number]) => {
    if (name === 'Provenance gate' && attack) return 'bad';
    if (name === 'Ground station' && jam) return 'warn';
    return '';
  };

  return (
    <div className="chain" aria-label="Earth-observation data chain">
      <div className="chain__head">
        <span className="overline">EO data chain</span>
        <span className={`chain__count ${active ? 'chain__count--pulse' : ''}`}>
          <CheckIcon size={13} />
          Corrupted frames reaching the analyst: {engine.corruptedToAnalyst}
        </span>
      </div>
      <ol className="chain__nodes">
        {NODES.map((name, i) => (
          <li key={name} className="chain__item">
            <span
              className={`chain__node ${nodeTone(name) ? `chain__node--${nodeTone(name)}` : ''}`}
            >
              {name === 'Provenance gate' && attack ? (
                <>
                  <AlertIcon size={12} /> Gate: blocked
                </>
              ) : (
                name
              )}
            </span>
            {i < NODES.length - 1 && (
              <span className={`chain__link chain__link--${linkState(i)}`} aria-hidden="true">
                <span className="chain__packet" />
                <span className="chain__packet" />
                <ArrowIcon size={12} className="chain__arrow" />
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="chain__foot">
        Frames: synthetic emulation until the official reference dataset is loaded · everything runs
        locally in your browser
      </p>
    </div>
  );
}

export function ViewportPanel() {
  const { engine, focus, setFocus } = useEngineCtx();
  const live = useEngine(4);
  const reduced = usePrefersReducedMotion();
  return (
    <Panel
      badge="1"
      title="Ground-link segment · 3D"
      tag="D1 · GRSS"
      alert={live.state === 'UNDER ATTACK'}
      className="panel--viewport"
      headerExtra={
        <span className="panel__hint">
          <CubeIcon size={13} /> real-time WebGL
        </span>
      }
    >
      <div className={`viewport viewport--${focus}`}>
        <Suspense fallback={<div className="viewport__loading">Loading 3D scene…</div>}>
          <Scene engine={engine} focus={focus} setFocus={setFocus} reduced={reduced} />
        </Suspense>
        <Hud />
        <FocusOverlay />
      </div>
      <ChainStrip />
    </Panel>
  );
}
