import { useMemo } from 'react';

import { useEngine } from '../engineContext';
import type { LedgerRow, Verdict } from '../sim/engine';
import { shortHash } from '../sim/crypto';
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

function Row({ row, first }: { row: LedgerRow; first: boolean }) {
  const tone = TONE[row.verdict];
  const broken = row.verdict !== 'VERIFIED';
  return (
    <li className={`ledger__row ledger__row--${tone} ${first ? 'ledger__row--new' : ''}`}>
      <span
        className={`ledger__spine ${broken ? `ledger__spine--broken ledger__spine--${tone}` : ''}`}
        aria-hidden="true"
      >
        <span className="ledger__dot" />
      </span>
      <span className="ledger__seq">
        {row.seq === null ? '—' : row.seq.toString(16).padStart(6, '0')}
      </span>
      <span className="ledger__hash">
        {row.hash ? (
          <span className="ledger__hash-text">{shortHash(row.hash)}</span>
        ) : (
          <span className="ledger__muted">no signal</span>
        )}
      </span>
      <span className="ledger__source" title={row.source}>
        {row.source}
      </span>
      <span className="ledger__seal">
        <WaxSeal verdict={row.verdict} />
        <span className={`tag tag--${tone}`}>{row.verdict}</span>
      </span>
    </li>
  );
}

export function LedgerPanel() {
  const engine = useEngine(8);
  const rows = engine.logEvents
    ? engine.ledger
    : engine.ledger.filter((r) => r.verdict !== 'VERIFIED');
  const flashing = engine.s - engine.keyFlashAt < 1.2;
  const alert = engine.state === 'UNDER ATTACK';
  const overhead = engine.medianOverheadMs;
  return (
    <Panel
      badge="2B"
      title="Provenance ledger"
      tag="D2 · Trust anchor"
      alert={alert}
      className="panel--ledger"
    >
      <div className="anchor-line">
        <span className="anchor-line__name">Trust anchor</span>
        <span className="anchor-line__detail">emulated HSM · HMAC-SHA256</span>
        <span className={`anchor-line__epoch ${flashing ? 'anchor-line__epoch--flash' : ''}`}>
          key epoch {fmtEpoch(engine.keyEpoch)}
        </span>
      </div>
      <div className="ledger__head" aria-hidden="true">
        <span />
        <span>SEQ</span>
        <span>SHA-256 chain</span>
        <span>Source</span>
        <span>Seal</span>
      </div>
      <ol className="ledger" aria-label="Most recent frames, newest first">
        {rows.slice(0, 14).map((row, i) => (
          <Row key={row.id} row={row} first={i === 0} />
        ))}
      </ol>
      <div className="ledger__foot">
        <span>
          {engine.framesVerified.toLocaleString('en-US')} verified · {engine.framesRejected}{' '}
          rejected · {engine.framesLost} lost
        </span>
        <span>{overhead === null ? '' : `${fmtMs(overhead)} per frame · measured`}</span>
      </div>
    </Panel>
  );
}
