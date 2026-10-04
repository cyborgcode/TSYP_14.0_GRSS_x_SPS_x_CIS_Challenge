import { useEngine, useEngineCtx } from '../engineContext';
import { ATTACK_BUTTONS } from '../sim/copy';
import type { LayerStats, StatKey } from '../sim/engine';
import { CheckIcon, CrossIcon, SearchIcon } from './icons';
import { Panel } from './Panel';

const ROWS: { key: StatKey; label: string; title: string; genuine: boolean }[] = [
  { key: 'genuine', label: 'Genuine', title: 'Genuine frames, no attack running', genuine: true },
  {
    key: 'genuineUnderAttack',
    label: 'Genuine (attack)',
    title: 'Genuine frames sent while an attack was running',
    genuine: true,
  },
  { key: 'spoof', label: 'Spoofing', title: ATTACK_BUTTONS.spoof.label, genuine: false },
  { key: 'tamper', label: 'Tampering', title: ATTACK_BUTTONS.tamper.label, genuine: false },
  { key: 'hijack', label: 'Hijacking', title: ATTACK_BUTTONS.hijack.label, genuine: false },
  { key: 'jam', label: 'Jamming', title: ATTACK_BUTTONS.jam.label, genuine: false },
];

const rate = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

function median(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function MatrixRow({
  kind,
  label,
  title,
  st,
  genuine,
}: {
  kind: StatKey;
  label: string;
  title: string;
  st?: LayerStats;
  genuine: boolean;
}) {
  const frames = st?.frames ?? 0;
  const dropped = st?.blocked ?? 0;
  // Genuine rows should be allowed (drop = false alarm); attack rows should all be dropped.
  const good = !frames || (genuine ? dropped / frames < 0.05 : dropped === frames);
  const first = median(st?.firstBlockMs ?? []);
  return (
    <div className={`rmatrix__row ${frames ? '' : 'rmatrix__row--idle'}`} role="row">
      <span className="rmatrix__name" role="cell" title={title}>
        {!genuine && <span className={`plist__dot plabel--${kind}`} />}
        {label}
      </span>
      <span className="mono" role="cell">
        {frames || '—'}
      </span>
      <span className="mono" role="cell">
        {st && st.decoded ? rate(st.anchor, st.decoded) : '—'}
      </span>
      <span className="mono" role="cell">
        {rate(st?.detector ?? 0, frames)}
      </span>
      <span className={`mono rmatrix__drop ${good ? 'is-ok' : 'is-bad'}`} role="cell">
        {rate(dropped, frames)}
      </span>
      <span className="mono" role="cell">
        {genuine ? '' : first === null ? '—' : `${Math.round(first)} ms`}
      </span>
    </div>
  );
}

export function ResiliencePanel() {
  const engine = useEngine(4);
  const { setInspectorOpen } = useEngineCtx();
  const chain = engine.chainStatus;
  const corrupted = engine.corruptedToAnalyst;

  return (
    <Panel
      badge="5"
      title="Resilience & trust metrics"
      tag="Live"
      alert={chain !== null && !chain.ok}
      className="panel--resilience"
      headerExtra={
        <button
          type="button"
          className="panel__action"
          onClick={() => setInspectorOpen(true)}
          aria-label="Inspect packets"
          aria-controls="packet-drawer"
        >
          <SearchIcon size={12} />
          <span className="panel__action-text">Packets</span>
        </button>
      }
    >
      <div className="rkpis">
        <div className="rkpi">
          <span className="rkpi__v mono">{engine.framesVerified}</span>
          <span className="rkpi__k">authenticated</span>
        </div>
        <div
          className="rkpi"
          title={`Rejected by trust_anchor.py: ${engine.rejectedMac} MAC mismatch · ${engine.rejectedNonce} stale nonce`}
        >
          <span className="rkpi__v mono rkpi__v--bad">{engine.framesRejected}</span>
          <span className="rkpi__k">rejected</span>
        </div>
        <div className="rkpi" title="Authentic frames dropped by zero_trust.py on an RF anomaly">
          <span className="rkpi__v mono rkpi__v--warn">{engine.heldByZeroTrust}</span>
          <span className="rkpi__k">held on RF</span>
        </div>
        <div className="rkpi" title="Corrupted frames that reached the analyst">
          <span className={`rkpi__v mono ${corrupted ? 'rkpi__v--bad' : 'rkpi__v--ok'}`}>
            {corrupted}
          </span>
          <span className="rkpi__k">to analyst</span>
        </div>
      </div>

      <div className={`rchain ${chain && !chain.ok ? 'rchain--bad' : ''}`}>
        <span className="rchain__status" title={chain?.message}>
          {chain === null ? (
            <span className="pmuted rchain__text">verify_chain() · first check after 5 s</span>
          ) : chain.ok ? (
            <>
              <CheckIcon size={13} className="is-ok" />
              <span className="rchain__text">
                verify_chain() · <span className="mono">{chain.blocks}</span> blocks intact
                {chain.full ? ' to genesis' : ''} ·{' '}
                <span className="mono">
                  {chain.ms < 1 ? chain.ms.toFixed(2) : chain.ms.toFixed(1)} ms
                </span>
              </span>
            </>
          ) : (
            <>
              <CrossIcon size={13} className="is-bad" />
              <span className="rchain__text">{chain.message}</span>
            </>
          )}
        </span>
        <span className="rchain__actions">
          <button
            type="button"
            className="rbtn"
            onClick={() => void engine.checkChain(true)}
            title="Re-run verify_chain() from the genesis block"
          >
            Verify
          </button>
          <button
            type="button"
            className="rbtn rbtn--bad"
            onClick={() => void engine.tamperLedger()}
            disabled={engine.ledgerTamper !== null || engine.anchor.height < 4}
            title="Red team: edit the verdict recorded in a past ledger block"
          >
            {engine.ledgerTamper ? 'Restoring…' : 'Edit block'}
          </button>
        </span>
      </div>

      <div className="rmatrix" role="table" aria-label="Detection by layer and scenario">
        <div className="rmatrix__row rmatrix__row--head" role="row">
          <span role="columnheader">Traffic</span>
          <span role="columnheader">Frames</span>
          <span role="columnheader" title="trust_anchor.py rejections among decoded frames">
            Anchor
          </span>
          <span role="columnheader" title="detector.py anomalies (physics gate or forest)">
            AI/RF
          </span>
          <span role="columnheader" title="zero_trust.py QUARANTINE_AND_DROP">
            Drop
          </span>
          <span role="columnheader" title="Median time from attack start to the first drop">
            First
          </span>
        </div>
        {ROWS.map((r) => (
          <MatrixRow
            key={r.key}
            kind={r.key}
            label={r.label}
            title={r.title}
            st={engine.layerStats[r.key]}
            genuine={r.genuine}
          />
        ))}
      </div>
    </Panel>
  );
}
