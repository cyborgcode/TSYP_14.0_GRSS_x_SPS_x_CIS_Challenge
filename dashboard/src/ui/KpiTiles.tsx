import { useEffect, useRef, useState } from 'react';

import { useEngine } from '../engineContext';
import { easeOutCubic } from '../sim/noise';
import { fmtMs } from './format';
import { AlertIcon, ATTACK_ICONS, CheckIcon } from './icons';
import { SampleBadge } from './Panel';

function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      if (start.current === null) start.current = now;
      const p = Math.min(1, (now - start.current) / duration);
      setValue(target * easeOutCubic(p));
      if (p < 1) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return value;
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted';

function Tile({
  label,
  value,
  note,
  tone = 'muted',
  alert = false,
  sample = false,
}: {
  label: string;
  value: string;
  note: string;
  tone?: Tone;
  alert?: boolean;
  sample?: boolean;
}) {
  return (
    <div className={`tile ${alert ? 'tile--alert' : ''}`}>
      <div className="tile__label">
        {label}
        {sample && <span className="tile__sample">sample</span>}
      </div>
      <div className="tile__row">
        <span className="tile__value mono">{value}</span>
        <span className={`tile__note tile__note--${tone}`}>{note}</span>
      </div>
    </div>
  );
}

function Banner() {
  const engine = useEngine(15);
  const b = engine.banner;
  if (!b) return null;
  const Icon = b.tone === 'ok' ? CheckIcon : (ATTACK_ICONS[b.kind] ?? AlertIcon);
  const since = engine.run ? engine.s - engine.run.tTrigger : engine.s - b.shownAt;
  return (
    <div
      key={`${b.kind}-${b.tone}-${b.shownAt}`}
      className={`banner banner--${b.tone}`}
      role="alert"
    >
      <span className="banner__hazard" aria-hidden="true" />
      <span className="banner__icon">
        <Icon size={22} />
      </span>
      <div className="banner__text">
        <div className="banner__headline">
          {b.tone === 'ok' ? `RESOLVED · ${b.headline}` : b.headline}
        </div>
        <div className="banner__detail">{b.detail}</div>
      </div>
      <span className="banner__time mono">T+{since.toFixed(1)} s</span>
    </div>
  );
}

export function KpiTiles() {
  const engine = useEngine(6);
  const detection = useCountUp(97.8);
  const far = useCountUp(0.6);
  const attack = engine.state === 'UNDER ATTACK';
  const jamming = engine.state === 'JAMMING';
  const overhead = engine.medianOverheadMs;
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
    ?.usedJSHeapSize;
  const last = engine.lastRun;
  const integrity = engine.linkIntegrity;
  const measuredDetect = engine.medianEscalateMs;

  return (
    <div className="kpis-wrap">
      <div className="kpis-head">
        <span className="overline">Evaluation · standard scenario</span>
        <SampleBadge />
        <span className="kpis-head__note">
          Tiles marked sample are placeholders; the rest are measured live in this browser.
        </span>
      </div>
      <div className="kpis">
        <Tile
          label="Frames verified"
          value={engine.framesVerified.toLocaleString('en-US')}
          note={`+${engine.verifiedPerSecond.toFixed(1)} per second`}
          tone="ok"
        />
        <Tile
          label="Detection rate"
          value={`${detection.toFixed(1)}%`}
          note="standard scenario"
          sample
        />
        <Tile label="False-alarm rate" value={`${far.toFixed(1)}%`} note="2-of-3 fusion" sample />
        <Tile
          label="Security overhead"
          value={overhead === null ? '—' : `+${fmtMs(overhead)}`}
          note={heap ? `per frame · ${Math.round(heap / 1048576)} MB heap` : 'per frame · measured'}
        />
        <Tile
          label="Time to detect"
          value={
            last?.escalateMs != null
              ? fmtMs(last.escalateMs)
              : measuredDetect === null
                ? '—'
                : fmtMs(measuredDetect)
          }
          note={last?.escalateMs != null ? 'last event' : 'no events yet'}
          tone={jamming ? 'warn' : attack ? 'bad' : 'muted'}
          alert={attack}
        />
        <Tile
          label="Link integrity"
          value={`${(Math.min(1, integrity) * 100).toFixed(1)}%`}
          note={integrity < 0.999 ? 'frames rejected' : 'all frames verified'}
          tone={integrity < 0.999 ? 'bad' : 'ok'}
          alert={attack}
        />
        <Banner />
      </div>
    </div>
  );
}
