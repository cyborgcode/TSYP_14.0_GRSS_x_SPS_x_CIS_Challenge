import { useEffect, useRef, useState } from 'react';

import { useEngine, useEngineCtx } from '../engineContext';
import { ATTACK_BUTTONS } from '../sim/copy';
import type { PacketRecord } from '../sim/engine';
import {
  FEATURE_NAMES,
  MAX_CARRIER_RESIDUAL_MHZ,
  MAX_CARRIER_STEP_MHZ,
  MAX_RSSI_RESIDUAL_DB,
} from '../sim/linkDetector';
import { CheckIcon, CloseIcon, CrossIcon } from './icons';

type Filter = 'all' | 'redteam' | 'dropped';

const LIST_ROWS = 80;

const LABEL_TEXT = (p: PacketRecord) =>
  p.label === 'genuine' ? 'Genuine' : ATTACK_BUTTONS[p.label].label;

const AUTH_TEXT: Record<PacketRecord['auth']['reason'], string> = {
  AUTHENTIC: 'AUTHENTIC',
  MAC_MISMATCH: 'MAC_MISMATCH',
  STALE_OR_REUSED_NONCE: 'STALE_NONCE',
  NO_FRAME: 'NO FRAME',
};

const FEATURE_UNIT = ['MHz', 'dB', 'MHz', 'dB'] as const;
const FEATURE_LIMIT: (number | null)[] = [
  MAX_CARRIER_RESIDUAL_MHZ,
  MAX_RSSI_RESIDUAL_DB,
  MAX_CARRIER_STEP_MHZ,
  null,
];

const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
const signed = (v: number, digits: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;

function Hex({ text, compare }: { text: string; compare?: string | null }) {
  // Splits a 64-char digest into two rows and marks the characters that differ from `compare`.
  const rows = text.match(/.{1,32}/g) ?? [];
  return (
    <span className="hex">
      {rows.map((row, r) => (
        <span key={r} className="hex__row">
          {compare
            ? Array.from(row, (c, i) => {
                const other = compare[r * 32 + i];
                return (
                  <span key={i} className={other !== undefined && other !== c ? 'hex--diff' : ''}>
                    {c}
                  </span>
                );
              })
            : row}
        </span>
      ))}
    </span>
  );
}

/** 32-byte payload as a classic hexdump, the flipped byte highlighted against what was sealed. */
function Hexdump({ p }: { p: PacketRecord }) {
  const payload = p.frame?.payload ?? '';
  const bytes = payload.match(/../g) ?? [];
  const original = p.originalPayload?.match(/../g) ?? null;
  const lines: string[][] = [];
  for (let i = 0; i < bytes.length; i += 16) lines.push(bytes.slice(i, i + 16));
  return (
    <div className="hexdump" role="table" aria-label="Received payload bytes">
      {lines.map((line, li) => (
        <div key={li} className="hexdump__line" role="row">
          <span className="hexdump__off">{(li * 16).toString(16).padStart(4, '0')}</span>
          <span className="hexdump__bytes">
            {line.map((b, bi) => {
              const idx = li * 16 + bi;
              const flipped = original !== null && original[idx] !== b;
              return (
                <span
                  key={bi}
                  className={flipped ? 'hexdump__byte hexdump__byte--flip' : 'hexdump__byte'}
                  title={flipped ? `sealed as ${original![idx]}` : undefined}
                >
                  {b}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

function Status({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span className={`pstat pstat--${ok ? 'ok' : 'bad'}`}>
      {ok ? <CheckIcon size={12} /> : <CrossIcon size={12} />}
      {children}
    </span>
  );
}

function Section({
  file,
  title,
  verdict,
  children,
}: {
  file: string;
  title: string;
  verdict?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="psec">
      <header className="psec__head">
        <span className="psec__file mono">{file}</span>
        <span className="psec__title">{title}</span>
        {verdict}
      </header>
      {children}
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="prow">
      <span className="prow__k">{k}</span>
      <span className="prow__v">{children}</span>
    </div>
  );
}

function Detail({ p }: { p: PacketRecord }) {
  const engine = useEngine(4);
  const chain = engine.chainStatus;
  const d = p.detector;
  const flip = p.flipped;
  const nonceText =
    p.auth.reason === 'MAC_MISMATCH'
      ? 'not checked: the MAC failed first, so a forgery can never burn a genuine nonce'
      : p.auth.reason === 'STALE_OR_REUSED_NONCE'
        ? `sequence ${p.frame?.sequence} already seen or older than the 64-frame window`
        : `sequence ${p.frame?.sequence} fresh · accepted into the 64-frame window`;

  return (
    <div className="pdetail">
      <div className="pdetail__head">
        <span className="pdetail__id mono">Packet #{p.id}</span>
        <span className="pdetail__meta mono">
          t = {p.t.toFixed(2)} s · {p.source}
        </span>
        <span
          className={`plabel plabel--${p.label}`}
          title="Red-team ground truth, shown for the jury. The pipeline never reads it."
        >
          ground truth: {LABEL_TEXT(p)}
        </span>
      </div>

      <Section file="ingester.py" title="Raw packet">
        {p.frame ? (
          <>
            <Row k="Frame">
              <span className="mono pwrap">
                {p.frame.satellite_id}|{p.frame.sequence}|{p.frame.timestamp.toFixed(6)}|
                {p.frame.hw_token}|<span className="pmuted">payload</span>
              </span>
            </Row>
            <Hexdump p={p} />
            {flip && p.originalPayload && (
              <p className="pnote pnote--bad">
                Byte 0x{flip.byte.toString(16).padStart(2, '0')} bit {flip.bit} flipped in transit:{' '}
                <span className="mono">
                  {p.originalPayload.slice(flip.byte * 2, flip.byte * 2 + 2)} →{' '}
                  {p.frame.payload.slice(flip.byte * 2, flip.byte * 2 + 2)}
                </span>
                . RF is untouched: only the hash can see this.
              </p>
            )}
          </>
        ) : (
          <p className="pnote pnote--warn">
            No frame decoded: the receiver lost the carrier. Nothing reaches the trust anchor; the
            RF still goes through detector.py.
          </p>
        )}
      </Section>

      {p.frame && (
        <Section
          file="trust_anchor.py"
          title="Hash verification"
          verdict={<Status ok={p.auth.ok}>{AUTH_TEXT[p.auth.reason]}</Status>}
        >
          <Row k="MAC received">
            <Hex text={p.mac!} compare={p.expectedMac} />
          </Row>
          <Row k={`HMAC-SHA256 · epoch 0x${p.keyEpoch.toString(16).toUpperCase()}`}>
            <Hex text={p.expectedMac!} />
          </Row>
          <Row k="MAC check">
            <Status ok={p.mac === p.expectedMac}>
              {p.mac === p.expectedMac
                ? 'match · constant-time compare'
                : 'mismatch · frame not sealed by this key'}
            </Status>
          </Row>
          <Row k="Anti-replay">
            <span className={p.auth.reason === 'STALE_OR_REUSED_NONCE' ? 'pbad' : ''}>
              {nonceText}
            </span>
          </Row>
          <Row k="SHA-256(frame)">
            <Hex text={p.frameDigest!} />
          </Row>
          {p.block && (
            <>
              <Row k={`Ledger block #${p.block.index}`}>
                <span className="mono pchain">
                  <span className="pmuted">prev</span> {p.block.previous_hash.slice(0, 16)}…
                  <br />
                  <span className="pmuted">hash</span> {p.block.hash.slice(0, 16)}…
                </span>
              </Row>
              <Row k="verify_chain()">
                {chain ? (
                  <Status ok={chain.ok}>
                    {chain.ok
                      ? `intact · ${chain.blocks} blocks to genesis`
                      : chain.message.replace(/\.$/, '')}
                  </Status>
                ) : (
                  <span className="pmuted">first check after 5 s</span>
                )}
              </Row>
            </>
          )}
          <Row k="Cost">
            <span className="mono">{p.authMs.toFixed(2)} ms</span>
          </Row>
        </Section>
      )}

      {d && (
        <Section
          file="detector.py"
          title="AI anomaly detection"
          verdict={<Status ok={!d.anomaly}>{d.anomaly ? 'ANOMALY' : 'NOMINAL'}</Status>}
        >
          <div className="pconf">
            <div className="pconf__num mono">{(d.confidence * 100).toFixed(1)}%</div>
            <div className="pconf__body">
              <div className="pconf__label">AI confidence this packet is anomalous</div>
              <div className="pconf__bar">
                <span
                  className={`pconf__fill ${d.forest ? 'pconf__fill--bad' : d.confidence > 0.9 ? 'pconf__fill--warn' : ''}`}
                  style={{ width: `${d.confidence * 100}%` }}
                />
                <span className="pconf__tick" style={{ left: '99%' }} title="1 % contamination" />
              </div>
              <div className="pconf__sub mono">
                IF score {d.score.toFixed(3)} · threshold {d.threshold.toFixed(3)} (1 %
                contamination)
              </div>
            </div>
          </div>
          <div className="pfeat" role="table" aria-label="Detector features">
            <div className="pfeat__row pfeat__row--head" role="row">
              <span>Feature</span>
              <span>Value</span>
              <span>Physics limit</span>
            </div>
            {d.features.map((v, i) => {
              const limit = FEATURE_LIMIT[i];
              const out = limit !== null && Math.abs(v) > limit;
              return (
                <div key={i} className={`pfeat__row ${out ? 'pfeat__row--bad' : ''}`} role="row">
                  <span>{FEATURE_NAMES[i]}</span>
                  <span className="mono">
                    {signed(v, FEATURE_UNIT[i] === 'MHz' ? 4 : 2)} {FEATURE_UNIT[i]}
                  </span>
                  <span className="mono">
                    {limit === null ? 'forest only' : `±${limit} ${FEATURE_UNIT[i]}`}
                  </span>
                </div>
              );
            })}
          </div>
          <Row k="Physics gate">
            {d.physics ? (
              <span className="pbad">{d.physicsReasons.join(' · ')}</span>
            ) : (
              <span>within orbit physics</span>
            )}
          </Row>
          <Row k="Isolation Forest">
            <span className={d.forest ? 'pbad' : ''}>
              {d.forest ? 'outside the nominal envelope' : 'inside the nominal envelope'} ·{' '}
              {pct(d.confidence)} of held-out nominal packets score lower
            </span>
          </Row>
          <Row k="Cost">
            <span className="mono">{p.detectorMs.toFixed(2)} ms</span>
          </Row>
        </Section>
      )}

      <Section
        file="zero_trust.py"
        title="Access decision"
        verdict={<Status ok={p.decision.allow}>{p.decision.action}</Status>}
      >
        {p.decision.reasons.length ? (
          <ul className="preasons">
            {p.decision.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="pnote pnote--ok">
            Every check passed: authentic, fresh, cleared hardware token, nominal RF.
          </p>
        )}
      </Section>
    </div>
  );
}

export function PacketDrawer() {
  const engine = useEngine(4);
  const { inspectorOpen, setInspectorOpen } = useEngineCtx();
  const [filter, setFilter] = useState<Filter>('all');
  /** Snapshot of the list while paused, so the jury can read a packet without it scrolling away. */
  const [frozen, setFrozen] = useState<PacketRecord[] | null>(null);
  const [picked, setPicked] = useState<PacketRecord | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!inspectorOpen) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectorOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inspectorOpen, setInspectorOpen]);

  if (!inspectorOpen) return null;

  const paused = frozen !== null;
  const source = frozen ?? engine.packets;
  const list = source
    .filter((p) =>
      filter === 'redteam'
        ? p.label !== 'genuine'
        : filter === 'dropped'
          ? !p.decision.allow
          : true,
    )
    .slice(0, LIST_ROWS);

  // Follow mode: the newest red-team packet while an attack runs, else the newest packet.
  const follow = engine.run ? (list.find((p) => p.label === engine.run!.kind) ?? list[0]) : list[0];
  const selected = picked ?? follow ?? null;
  const counts = {
    total: source.length,
    dropped: source.filter((p) => !p.decision.allow).length,
  };

  return (
    <aside
      id="packet-drawer"
      className="drawer"
      role="dialog"
      aria-modal="false"
      aria-labelledby="drawer-title"
    >
      <header className="drawer__head">
        <div className="drawer__titles">
          <h2 id="drawer-title" className="drawer__title">
            Packet inspection
          </h2>
          <span className="drawer__sub">
            Every frame through trust_anchor.py, detector.py and zero_trust.py
          </span>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          onClick={() => setInspectorOpen(false)}
          aria-label="Close packet inspection"
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="drawer__bar">
        <div className="seg" role="group" aria-label="Filter packets">
          {(
            [
              ['all', 'All'],
              ['redteam', 'Red team'],
              ['dropped', 'Dropped'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`seg__btn ${filter === k ? 'seg__btn--on' : ''}`}
              aria-pressed={filter === k}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="drawer__count mono">
          {counts.dropped}/{counts.total} dropped
        </span>
        <button
          type="button"
          className={`seg__btn seg__btn--solo ${paused ? 'seg__btn--on' : ''}`}
          aria-pressed={paused}
          onClick={() => setFrozen(paused ? null : engine.packets.slice())}
        >
          {paused ? 'Paused' : 'Live'}
        </button>
        {picked && (
          <button type="button" className="seg__btn seg__btn--solo" onClick={() => setPicked(null)}>
            Follow latest
          </button>
        )}
      </div>

      <div className="plist" role="listbox" aria-label="Packets, newest first">
        {list.length === 0 && <p className="plist__empty">No packets match this filter yet.</p>}
        {list.map((p) => {
          const conf = p.detector?.confidence ?? 0;
          return (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={selected?.id === p.id}
              className={`plist__row ${selected?.id === p.id ? 'plist__row--on' : ''}`}
              onClick={() => setPicked(p)}
            >
              <span className={`plist__dot plabel--${p.label}`} title={LABEL_TEXT(p)} />
              <span className="mono plist__seq">{p.frame ? `#${p.frame.sequence}` : '—'}</span>
              <span className={`plist__auth ${p.auth.ok ? 'is-ok' : 'is-bad'}`}>
                {AUTH_TEXT[p.auth.reason]}
              </span>
              <span className="plist__conf" title={`AI confidence ${pct(conf)}`}>
                <span
                  className={`plist__confFill ${p.detector?.anomaly ? 'is-bad' : ''}`}
                  style={{ width: `${conf * 100}%` }}
                />
              </span>
              <span className={`plist__dec ${p.decision.allow ? 'is-ok' : 'is-bad'}`}>
                {p.decision.allow ? 'ALLOW' : 'DROP'}
              </span>
            </button>
          );
        })}
      </div>

      <div className="drawer__detail">
        {selected ? (
          <Detail p={selected} />
        ) : (
          <p className="plist__empty">Waiting for the first frame of the pass…</p>
        )}
      </div>
    </aside>
  );
}
