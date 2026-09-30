import { useLayoutEffect, useMemo, useRef } from 'react';

import { useEngine } from '../engineContext';
import { STATION } from '../sim/copy';
import type { Verdict } from '../sim/engine';
import { fmtEpoch, fmtMs } from './format';
import { Panel } from './Panel';

const TONE: Record<Verdict, 'ok' | 'bad' | 'warn' | 'muted'> = {
  VERIFIED: 'ok',
  'MAC FAIL': 'bad',
  REPLAY: 'bad',
  LOST: 'muted',
  QUARANTINED: 'warn',
};

/** Scalloped wax seal (28 lobes) with a check when intact, a crack when broken. */
export function WaxSeal({ verdict, size = 22 }: { verdict: Verdict; size?: number }) {
  const path = useMemo(() => {
    const pts: string[] = [];
    const n = 56;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = i % 2 === 0 ? 11 : 9.9;
      pts.push(`${(12 + Math.cos(a) * r).toFixed(2)},${(12 + Math.sin(a) * r).toFixed(2)}`);
    }
    return `M${pts.join('L')}Z`;
  }, []);
  const tone = TONE[verdict];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`seal seal--${tone}`}
      aria-hidden="true"
    >
      <path d={path} className="seal__body" />
      <circle cx="12" cy="12" r="7.2" className="seal__ring" />
      {verdict === 'VERIFIED' ? (
        <path d="M8.2 12.3l2.6 2.6 5-5.4" className="seal__mark" />
      ) : verdict === 'LOST' ? (
        <path d="M8 12h8" className="seal__mark" />
      ) : (
        <path d="M13.5 5.5l-2.5 4 2.5 2-3 3.5 1.5 3.5" className="seal__mark" />
      )}
    </svg>
  );
}

const VISIBLE_LINES = 80;

function Terminal() {
  const engine = useEngine(8);
  const body = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lines = engine.terminal.slice(-VISIBLE_LINES);
  const lastId = lines[lines.length - 1]?.id;

  // Follow the newest line unless the reader has scrolled up to look at older ones.
  useLayoutEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId]);

  return (
    <div className="term">
      <div className="term__bar" aria-hidden="true">
        <span className="term__dot" />
        <span className="term__dot" />
        <span className="term__dot" />
        <span className="term__title">trust_anchor.py — {STATION}</span>
        <span className="term__epoch mono">epoch {fmtEpoch(engine.keyEpoch)}</span>
      </div>
      <div
        ref={body}
        className="term__body"
        role="log"
        aria-label="trust_anchor.py log"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {lines.map((l) => (
          <div key={l.id} className={`term__line term__line--${l.tone}`}>
            <span className="term__time">{l.t.toFixed(2).padStart(7, ' ')}</span>
            <span className="term__text">{l.text}</span>
          </div>
        ))}
        <div className="term__line">
          <span className="term__time" />
          <span className="term__cursor" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export function LedgerPanel() {
  const engine = useEngine(8);
  const flashing = engine.s - engine.keyFlashAt < 1.2;
  const alert = engine.state === 'UNDER ATTACK';
  const overhead = engine.medianOverheadMs;
  return (
    <Panel
      badge="2B"
      title="Cryptographic ledger"
      tag="D2 · Trust anchor"
      alert={alert}
      className="panel--ledger"
    >
      <div className="anchor-line">
        <span className="anchor-line__name">Trust anchor</span>
        <span className="anchor-line__detail">
          HMAC-SHA256 · SHA-256 chain · {engine.signer ? 'Ed25519' : 'Ed25519 unavailable'}
        </span>
        <span className={`anchor-line__epoch ${flashing ? 'anchor-line__epoch--flash' : ''}`}>
          key epoch {fmtEpoch(engine.keyEpoch)}
        </span>
      </div>
      <Terminal />
      <div className="ledger__foot">
        <span>
          block #{engine.blockHeight.toLocaleString('en-US')} · {engine.framesRejected} rejected ·{' '}
          {engine.framesLost} lost · {engine.handshakes}{' '}
          {engine.handshakes === 1 ? 'handshake' : 'handshakes'}
        </span>
        <span>{overhead === null ? '' : `${fmtMs(overhead)} per frame · measured`}</span>
      </div>
    </Panel>
  );
}
