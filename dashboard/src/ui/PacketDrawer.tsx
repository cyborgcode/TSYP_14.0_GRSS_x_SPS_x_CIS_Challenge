import { useEffect, useRef, useState } from 'react';

import { useEngine, useEngineCtx } from '../engineContext';
import { ATTACK_BUTTONS } from '../sim/copy';
import type { PacketRecord } from '../sim/engine';
import { FEATURE_NAMES, FEATURE_UNITS } from '../sim/linkDetector';
import {
  RESIDUAL_LABEL,
  RESIDUALS,
  elevationSpreadFactor,
  type LinkState,
  type Residual,
} from '../sim/physicsEngine';
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

const FEATURE_UNIT = FEATURE_UNITS;

/** How each residual of the physical layer is read off a link state, and printed. */
const CLAIM: Record<
  Residual,
  { unit: string; fmt: (v: number) => string; of: (l: LinkState) => number }
> = {
  rangeKm: { unit: 'km', fmt: (v) => v.toFixed(2), of: (l) => l.rangeKm },
  dopplerHz: {
    unit: 'Hz',
    fmt: (v) => Math.round(v).toLocaleString('en-US').replace('-', '−'),
    of: (l) => l.dopplerHz,
  },
  rssiDb: { unit: 'dBm', fmt: (v) => v.toFixed(2).replace('-', '−'), of: (l) => l.rssiDbm },
  phaseDeg: { unit: '°', fmt: (v) => v.toFixed(1).replace('-', '−'), of: (l) => l.phaseDeg },
};

const fmtBig = (v: number, digits = 1) =>
  Math.abs(v) >= 1e4 ? v.toExponential(2).replace('e+', 'e') : v.toFixed(digits);

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

function Status({
  ok,
  warn = false,
  children,
}: {
  ok: boolean;
  warn?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className={`pstat pstat--${warn ? 'warn' : ok ? 'ok' : 'bad'}`}>
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

/** Physical layer: what the signal claimed against what the orbit says, the chi-square gap. */
function PhysicsSection({ p }: { p: PacketRecord }) {
  const ph = p.physics;
  const link = p.link;
  if (!ph || !link) return null;
  const limit = Math.sqrt(ph.threshold);
  const kin = ph.kinematic;
  return (
    <Section
      file="security_detector.py"
      title="Physical layer · χ² engine"
      verdict={<Status ok={!ph.breach}>{ph.verdict}</Status>}
    >
      <div
        className="pfeat pfeat--4"
        role="table"
        aria-label="Signal claim against orbital physics"
      >
        <div className="pfeat__row pfeat__row--head" role="row">
          <span>Parameter</span>
          <span>Signal claims</span>
          <span>Orbit predicts</span>
          <span>Gap</span>
        </div>
        {RESIDUALS.map((name) => {
          const c = CLAIM[name];
          const z = ph.normalized[name];
          const out = Math.abs(z) > limit || (ph.chiSquareBreach && ph.dominant === name);
          return (
            <div key={name} className={`pfeat__row ${out ? 'pfeat__row--bad' : ''}`} role="row">
              <span>{RESIDUAL_LABEL[name]}</span>
              <span className="mono">
                {c.fmt(c.of(link.rx))} {c.unit}
              </span>
              <span className="mono">
                {c.fmt(c.of(link.truth))} {c.unit}
              </span>
              <span className="mono">
                {z < 0 ? '−' : '+'}
                {fmtBig(Math.abs(z))}σ
              </span>
            </div>
          );
        })}
      </div>
      <Row k={`χ² · ${ph.dof} dof`}>
        <Status ok={!ph.chiSquareBreach}>
          {fmtBig(ph.chiSquare)} {ph.chiSquareBreach ? '>' : '≤'} gate {ph.threshold.toFixed(1)} at{' '}
          {link.elevationDeg.toFixed(1)}° (×{elevationSpreadFactor(link.elevationDeg).toFixed(2)})
        </Status>
      </Row>
      <Row k="Kinematic coupling">
        {kin.available ? (
          <Status ok={!kin.breach}>
            range {signed(kin.rangeChangeKm, 2)} km vs Doppler {signed(kin.dopplerRangeChangeKm, 2)}{' '}
            km over {kin.intervalS.toFixed(1)} s · {signed(kin.z, 1)}σ (gate ±{kin.gateZ.toFixed(2)}
            )
          </Status>
        ) : (
          <span className="pmuted">no trusted frame in the last 30 s to integrate from</span>
        )}
      </Row>
      <Row k="Atmosphere">
        <span>
          ITU-R P.618 median: <span className="mono">{link.atmosphereDb.toFixed(2)} dB</span> at{' '}
          {link.elevationDeg.toFixed(1)}°, in the predicted power
        </span>
      </Row>
    </Section>
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
            No frame decoded: the receiver lost the carrier. Nothing reaches the data layer and
            there is nothing to range; the RF still goes through the forest.
          </p>
        )}
      </Section>

      {p.frame && (
        <Section
          file="trust_anchor.py"
          title="Data layer · hash verification"
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

      <PhysicsSection p={p} />

      {d && (
        <Section
          file="detector.py"
          title="Statistical layer · Isolation Forest"
          verdict={
            <Status ok={!d.forest}>{d.forest ? 'OUTSIDE ENVELOPE' : 'INSIDE ENVELOPE'}</Status>
          }
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
          <div className="pfeat pfeat--2" role="table" aria-label="Forest features">
            <div className="pfeat__row pfeat__row--head" role="row">
              <span>Feature</span>
              <span>Value</span>
            </div>
            {d.features.map((v, i) => (
              <div key={i} className="pfeat__row" role="row">
                <span>{FEATURE_NAMES[i]}</span>
                <span className="mono">
                  {signed(v, FEATURE_UNIT[i] === 'MHz' ? 4 : 2)} {FEATURE_UNIT[i]}
                </span>
              </div>
            ))}
          </div>
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
        file="physics_validator.py"
        title="Three-tier decision"
        verdict={
          <Status ok={p.decision.allow} warn={p.decision.verdict === 'DEGRADED'}>
            {p.decision.verdict}
          </Status>
        }
      >
        <Row k="Action">
          <span className="mono">{p.decision.action}</span>
        </Row>
        {p.decision.reasons.length ? (
          <ul
            className={`preasons ${p.decision.verdict === 'HELD' || p.decision.verdict === 'DEGRADED' ? 'preasons--warn' : ''}`}
          >
            {p.decision.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="pnote pnote--ok">
            Every tier passed: authentic and fresh, consistent with orbital physics, inside the
            nominal envelope.
          </p>
        )}
        <p className="pnote">
          Either deterministic layer, data or physical, rejects a frame; the statistical layer alone
          only holds it for review.
        </p>
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
            Every frame through the three tiers: data, physical, statistical
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
