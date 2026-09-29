// Testbed engine: one LEO pass over the Zaghouan ground station, framed and sealed for real,
// attacked on demand, and defended by three independent detectors fused by a 2-of-3 vote.
// The trust anchor chains every frame into a SHA-256 ledger from a genesis root and renews an
// Ed25519 handshake with the spacecraft; its log is streamed as the trust_anchor.py terminal.
//
// Everything here is emulation. No component transmits or receives RF.

import * as copy from './copy';
import { AiModel, FLAG_AT, featureVector } from './aiModel';
import {
  EmulatedHsm,
  ReplayWindow,
  chainHash,
  createEd25519,
  encodeHeader,
  encodeText,
  genesisRoot,
  importMacKey,
  macInput,
  macSign,
  macVerify,
  toHex,
  type Ed25519Identity,
} from './crypto';
import { PERIOD_S, passAt, snrPredDb, timeAfterAos, type PassState } from './geometry';
import { clamp, easeInOutCubic, mulberry32, win } from './noise';
import {
  GATES,
  checkGates,
  envelope,
  sample,
  type Attack,
  type AttackKind,
  type GateResult,
  type Sample,
} from './signals';

export const TICK_S = 0.05;
export const WINDOW_S = 7;
export const HISTORY = Math.round(WINDOW_S / TICK_S);
export const FRAME_PERIOD_S = 0.32;
const LEDGER_ROWS = 60;
const RESPONSE_DELAY_S: Record<AttackKind, number> = {
  hijack: 4.8,
  spoof: 2.8,
  jam: 2.8,
};
const UNANSWERED_END_S = 8;
const UNDETECTED_END_S = 6;
const ATTACKER_SHARE: Record<AttackKind, number> = {
  hijack: 0.75,
  spoof: 0.75,
  jam: 0,
};
const TERMINAL_LINES = 160;
const HANDSHAKE_EVERY_S = 8;

export type SystemState = 'NOMINAL' | 'CHECKING' | 'UNDER ATTACK' | 'JAMMING' | 'RECOVERING';
export type Verdict = 'VERIFIED' | 'MAC FAIL' | 'REPLAY' | 'LOST' | 'QUARANTINED';
export type DetectorId = 'PHYSICS' | 'TRUST' | 'AI';
export type Route = 'ZAG' | 'MAT';
export type FrameLabel = 'genuine' | AttackKind;

export type TermTone = 'info' | 'ok' | 'bad' | 'warn' | 'dim';

export interface TermLine {
  id: number;
  t: number;
  text: string;
  tone: TermTone;
}

export interface TelemetryPoint {
  s: number;
  x: Sample | null;
  gates: GateResult | null;
}

export interface LedgerRow {
  id: number;
  seq: number | null;
  hash: string | null;
  source: string;
  verdict: Verdict;
  original: Verdict;
  label: FrameLabel;
  t: number;
  overheadMs: number;
}

export interface TxFrame {
  seq: number;
  t: number;
  headerHex: string;
  payloadHex: string;
  macHex: string;
  epoch: number;
}

export interface DetectorState {
  flag: boolean;
  /** Milliseconds from attack start to this detector's first flag, for the current run. */
  latencyMs: number | null;
  evaded: boolean;
}

export interface Run {
  kind: AttackKind;
  tTrigger: number;
  start: number;
  escalatedAt: number | null;
  escalateMs: number | null;
  rejectMs: number | null;
  latency: Record<DetectorId, number | null>;
  auto: boolean;
  ended: boolean;
  respondedAt: number | null;
  firstRowId: number;
  demo: boolean;
}

export type Tone = 'bad' | 'warn' | 'ok';

export interface BannerState {
  kind: AttackKind;
  tone: Tone;
  headline: string;
  detail: string;
  shownAt: number;
  hideAt: number | null;
}

export type CalloutTarget = 'sat' | 'station' | 'telemetry' | 'ledger' | 'fusion' | 'deck';

export interface Callout {
  id: number;
  text: string;
  sub?: string;
  target: CalloutTarget;
  tone: Tone | 'info';
  until: number;
}

interface Arrival {
  t: number;
  outcome: 'ok' | 'fail' | 'lost';
}

interface SentFrame {
  seq: number;
  header: Uint8Array;
  payload: Uint8Array;
  tag: Uint8Array;
  t: number;
}

interface DemoEvent {
  at: number;
  run: (engine: Engine) => void;
}

const DEMO_EVENTS: DemoEvent[] = [
  { at: 0.4, run: (e) => e.say(copy.TOUR_CALLOUTS.controls, 'deck', 'info', 4) },
  { at: 7.4, run: (e) => e.say(copy.TOUR_CALLOUTS.lock, 'sat', 'info', 3.4) },
  { at: 10.2, run: (e) => e.say(copy.TOUR_CALLOUTS.gate, 'telemetry', 'info', 3.2) },
  { at: 12.2, run: (e) => e.say(copy.TOUR_CALLOUTS.chain, 'ledger', 'info', 3) },
  { at: 14.7, run: (e) => e.startFalseAlarm(1.5) },
  { at: 16.3, run: (e) => (e.heavyBatch = true) },
  { at: 17.9, run: (e) => (e.heavyBatch = false) },
  { at: 21.5, run: (e) => e.trigger('hijack', { demo: true }) },
  { at: 29.5, run: (e) => e.trigger('spoof', { demo: true }) },
  { at: 35.5, run: (e) => e.trigger('jam', { demo: true }) },
  { at: 42.5, run: (e) => e.stopDemo() },
];
export const DEMO_LENGTH_S = 42.5;

export class Engine {
  s = 0;
  pass: PassState;
  current: Sample | null = null;
  gates: GateResult | null = null;
  history: TelemetryPoint[] = [];

  ledger: LedgerRow[] = [];
  txLog: TxFrame[] = [];
  keyEpoch = 0x3f;
  keyFlashAt = -10;
  route: Route = 'ZAG';
  handoverAt = -10;

  power = 9;
  autoResponse = true;
  logEvents = true;
  heldOut = true;

  attack: Attack | null = null;
  run: Run | null = null;
  runs: Run[] = [];
  detectors: Record<DetectorId, DetectorState> = {
    PHYSICS: { flag: false, latencyMs: null, evaded: false },
    TRUST: { flag: false, latencyMs: null, evaded: false },
    AI: { flag: false, latencyMs: null, evaded: false },
  };
  votes = 0;
  state: SystemState = 'NOMINAL';
  banner: BannerState | null = null;
  callouts: Callout[] = [];
  statusLine = 'Ready · standard scenario';

  anomaly = 0.08;
  spoofLikelihood = 0.04;
  aiScore = 0.08;
  aiDriver = 0;
  features: number[] = [0, 0, 0, 0, 0, 0];
  heavyBatch = false;
  batchLoad = 0.32;

  quarantineUntil = -10;
  compromised: { from: number; to: number } | null = null;
  recoveringUntil = -10;

  framesSent = 0;
  framesVerified = 0;
  framesReceived = 0;
  framesRejected = 0;
  framesLost = 0;
  corruptedToAnalyst = 0;
  overheadMs: number[] = [];

  demo: { active: boolean; t0: number; next: number } = { active: false, t0: 0, next: 0 };
  eventCount = 0;

  terminal: TermLine[] = [];
  blockHeight = 0;
  readonly genesis: string;
  readonly signer: Ed25519Identity | null;
  handshakes = 0;

  readonly ai: AiModel;
  private passOffset: number;
  private acc = 0;
  private nextFrameAt = 0;
  private genuineSeq = 1_048_576;
  private sent: SentFrame[] = [];
  private arrivals: Arrival[] = [];
  private lastPhysicsViolation = -10;
  private rowId = 0;
  private calloutId = 0;
  private prevHash: string;
  private termId = 0;
  private nextHandshakeAt = HANDSHAKE_EVERY_S;
  private queue: Promise<void> = Promise.resolve();
  private readonly replayWindow = new ReplayWindow(64);
  private readonly rand = mulberry32(20261108);
  private falseAlarm: { from: number; to: number } | null = null;
  private faCallout: 'none' | 'held' | 'cleared' = 'none';
  private listeners = new Set<() => void>();
  private recentVectors: number[][] = [];
  private aiEvals: { t: number; n: number }[] = [];

  private readonly hsm: EmulatedHsm;
  private readonly attackerKey: CryptoKey;

  private constructor(
    hsm: EmulatedHsm,
    attackerKey: CryptoKey,
    ai: AiModel,
    genesis: string,
    signer: Ed25519Identity | null,
  ) {
    this.hsm = hsm;
    this.attackerKey = attackerKey;
    this.ai = ai;
    this.genesis = genesis;
    this.prevHash = genesis;
    this.signer = signer;
    this.passOffset = timeAfterAos(8);
    this.pass = passAt(this.passOffset);

    this.log(`$ python trust_anchor.py --node ${copy.STATION} --link x-band`, 'dim');
    this.log(`genesis root ${genesis.slice(0, 24)}…${genesis.slice(-8)}`, 'info');
    if (signer) {
      this.log(`Ed25519 pub ${copy.SATELLITE} ${signer.publicHex.slice(0, 24)}…`, 'info');
    } else {
      this.log('Ed25519 unavailable in this browser · HMAC-SHA256 seals only', 'warn');
    }
    this.handshake('session open');
  }

  static async create(): Promise<Engine> {
    const [hsm, attackerKey, genesis, signer] = await Promise.all([
      EmulatedHsm.create(),
      importMacKey(crypto.getRandomValues(new Uint8Array(32))),
      genesisRoot(copy.STATION),
      createEd25519(),
    ]);
    return new Engine(hsm, attackerKey, new AiModel(), genesis, signer);
  }

  // ---------------------------------------------------------------- trust_anchor.py log

  log(text: string, tone: TermTone = 'info') {
    this.terminal.push({ id: ++this.termId, t: this.s, text, tone });
    if (this.terminal.length > TERMINAL_LINES) this.terminal.shift();
  }

  /** Signs a fresh challenge with the spacecraft's Ed25519 key and verifies it at the station. */
  private handshake(reason: string) {
    const signer = this.signer;
    if (!signer) return;
    const epoch = this.keyEpoch;
    const challenge = encodeText(`${copy.STATION}|epoch:${epoch}|t:${this.s.toFixed(2)}`);
    this.queue = this.queue.then(async () => {
      const signature = await signer.sign(challenge);
      const ok = await signer.verify(challenge, signature);
      this.handshakes++;
      this.log(
        `Ed25519 handshake ${ok ? '✓' : '✗'} ${reason} · sig ${toHex(signature).slice(0, 12)}…`,
        ok ? 'ok' : 'bad',
      );
    });
  }

  // ---------------------------------------------------------------- subscriptions

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.eventCount++;
    for (const l of this.listeners) l();
  }

  /** Waits for every queued frame to finish cryptographic processing (tests). */
  settle(): Promise<void> {
    return this.queue;
  }

  // ---------------------------------------------------------------- controls

  get busy(): boolean {
    return this.attack !== null;
  }

  trigger(kind: AttackKind, opts: { demo?: boolean } = {}): boolean {
    if (this.attack) return false;
    const s = this.s;
    const power =
      kind === 'jam' && opts.demo
        ? (t: number) => (t < s ? 0 : 2 + 10 * easeInOutCubic(t - (s + 1.1)))
        : () => this.power;

    this.attack = { kind, tTrigger: s, tResponse: s + UNDETECTED_END_S, power };
    this.run = {
      kind,
      tTrigger: s,
      start: s + 0.05,
      escalatedAt: null,
      escalateMs: null,
      rejectMs: null,
      latency: { PHYSICS: null, TRUST: null, AI: null },
      auto: this.autoResponse,
      ended: false,
      respondedAt: null,
      firstRowId: this.rowId + 1,
      demo: Boolean(opts.demo),
    };
    for (const d of Object.values(this.detectors)) {
      d.latencyMs = null;
      d.evaded = false;
    }
    this.statusLine = `Running: ${copy.ATTACK_BUTTONS[kind].running}`;
    this.emit();
    return true;
  }

  setPower(db: number) {
    this.power = clamp(db, 0, 15);
  }

  /** Power currently applied by the running attack (the demo ramps it). */
  get appliedPower(): number {
    if (this.attack && this.run?.demo && this.attack.kind === 'jam')
      return this.attack.power(this.s);
    return this.power;
  }

  playDemo() {
    if (this.demo.active) return;
    this.attack = null;
    this.run = null;
    this.banner = null;
    this.compromised = null;
    this.route = 'ZAG';
    this.autoResponse = true;
    // Start a fresh pass so the whole schedule plays with the satellite in view.
    this.passOffset = timeAfterAos(3) - this.s;
    this.demo = { active: true, t0: this.s, next: 0 };
    this.statusLine = 'Ready · standard scenario';
    this.emit();
  }

  stopDemo() {
    this.demo.active = false;
    this.heavyBatch = false;
    this.emit();
  }

  startFalseAlarm(duration: number) {
    this.falseAlarm = { from: this.s, to: this.s + duration };
    this.faCallout = 'none';
  }

  say(
    c: { text: string; sub?: string },
    target: CalloutTarget,
    tone: Tone | 'info',
    seconds: number,
  ) {
    this.callouts.push({
      id: ++this.calloutId,
      text: c.text,
      sub: c.sub,
      target,
      tone,
      until: this.s + seconds,
    });
    if (this.callouts.length > 4) this.callouts.shift();
  }

  // ---------------------------------------------------------------- clock

  advance(realDtS: number) {
    this.acc += Math.min(realDtS, 0.25);
    let steps = 0;
    while (this.acc >= TICK_S && steps < 8) {
      this.step();
      this.acc -= TICK_S;
      steps++;
    }
  }

  step() {
    this.s += TICK_S;
    const s = this.s;

    if (this.demo.active) {
      const t = s - this.demo.t0;
      while (this.demo.next < DEMO_EVENTS.length && DEMO_EVENTS[this.demo.next].at <= t) {
        DEMO_EVENTS[this.demo.next++].run(this);
      }
    }

    const previousInView = this.pass.inView;
    this.pass = passAt(s + this.passOffset);
    if (this.route === 'MAT' && previousInView && !this.pass.inView) {
      this.route = 'ZAG';
      this.log(`route restored → ${copy.STATION} for the next pass`, 'info');
    }

    this.updateLifecycle(s);

    const attacks =
      this.attack && !(this.route === 'MAT' && this.attack.kind === 'jam') ? [this.attack] : [];
    const falseAlarm = this.falseAlarm
      ? win(s, this.falseAlarm.from, this.falseAlarm.to, 0.15, 0.4)
      : 0;

    if (this.pass.linkActive) {
      const handoverLoss = this.route === 'MAT' ? 1.2 : 0;
      this.current = sample(s, snrPredDb(this.pass.rangeKm) - handoverLoss, {
        attacks,
        falseAlarm,
        dopplerPredHz: this.pass.dopplerHz,
      });
      this.gates = checkGates(this.current);
      if (this.gates.any) this.lastPhysicsViolation = s;
    } else {
      this.current = null;
      this.gates = null;
    }
    this.history.push({ s, x: this.current, gates: this.gates });
    if (this.history.length > HISTORY) this.history.shift();

    if (this.pass.linkActive) {
      if (s >= this.nextFrameAt) {
        this.emitFrame(s);
        this.nextFrameAt = s + FRAME_PERIOD_S;
      }
    } else {
      this.nextFrameAt = s;
    }

    this.updateDetectors(s);
    this.updateState(s);

    if (s >= this.nextHandshakeAt) {
      this.nextHandshakeAt = s + HANDSHAKE_EVERY_S;
      if (this.pass.linkActive) this.handshake('periodic');
    }

    this.batchLoad +=
      ((this.heavyBatch ? 0.88 : 0.3 + 0.08 * Math.sin(s * 0.7)) - this.batchLoad) * 0.12;
    this.callouts = this.callouts.filter((c) => c.until > s);
    const banner = this.banner;
    if (banner && banner.hideAt !== null && s >= banner.hideAt) this.banner = null;
    while (this.arrivals.length && this.arrivals[0].t < s - 3) this.arrivals.shift();
    while (this.aiEvals.length && this.aiEvals[0].t < s - 1) this.aiEvals.shift();
  }

  // ---------------------------------------------------------------- frames

  private emitFrame(s: number) {
    const x = this.current;
    if (x && x.timingUs === null) {
      this.framesLost++;
      this.arrivals.push({ t: s, outcome: 'lost' });
      this.log(`⚠ frame missing · RSSI ${x.rssiDbm.toFixed(1)} dBm`, 'warn');
      this.pushRow({
        seq: null,
        hash: null,
        source: 'no signal',
        verdict: 'LOST',
        label: 'jam',
        t: s,
        overheadMs: 0,
      });
      return;
    }

    const kind = this.attack?.kind;
    const active = this.attack && kind && envelope(this.attack, s) > 0.3;
    const roll = this.rand();

    if (active && kind && roll < ATTACKER_SHARE[kind]) {
      const header = encodeHeader({ scid: 0x2a, vc: 1, tMs: s * 1000 });
      const payload = this.payload();
      // The hijacker pushes the next sequence number; node 0x99A2 forges nonces from recent ones.
      const seq =
        kind === 'spoof' ? this.genuineSeq - Math.floor(this.rand() * 24) : this.genuineSeq + 1;
      const source = kind === 'spoof' ? `NODE ${copy.ROGUE_NODE}` : 'ROGUE-TX +14.2 MHz';
      this.queue = this.queue.then(async () => {
        const tag = await macSign(this.attackerKey, macInput(header, seq, payload));
        await this.verify(header, seq, payload, tag, source, kind, s);
      });
      return;
    }

    const seq = ++this.genuineSeq;
    const header = encodeHeader({ scid: 0x2a, vc: 1, tMs: s * 1000 });
    const payload = this.payload();
    const epoch = this.keyEpoch;
    const source = `${copy.SATELLITE} · VC1 · ${this.route}`;
    this.framesSent++;
    this.queue = this.queue.then(async () => {
      const key = await this.hsm.epochKey(epoch);
      const tag = await macSign(key, macInput(header, seq, payload));
      this.sent.push({ seq, header, payload, tag, t: s });
      if (this.sent.length > 120) this.sent.shift();
      this.txLog.unshift({
        seq,
        t: s,
        headerHex: toHex(header),
        payloadHex: toHex(payload.subarray(0, 16)),
        macHex: toHex(tag),
        epoch,
      });
      if (this.txLog.length > 8) this.txLog.pop();
      await this.verify(header, seq, payload, tag, source, 'genuine', s);
    });
  }

  private payload(): Uint8Array {
    const p = new Uint8Array(32);
    for (let i = 0; i < p.length; i++) p[i] = Math.floor(this.rand() * 256);
    return p;
  }

  /** Station side: MAC → anti-replay → hash chain. Failing frames stop at the gate. */
  private async verify(
    header: Uint8Array,
    seq: number,
    payload: Uint8Array,
    tag: Uint8Array,
    source: string,
    label: FrameLabel,
    s: number,
  ) {
    const started = performance.now();
    const input = macInput(header, seq, payload);
    const key = await this.hsm.epochKey(this.keyEpoch);
    const macOk = await macVerify(key, input, tag);
    const verdict: Verdict = !macOk
      ? 'MAC FAIL'
      : this.replayWindow.accept(seq)
        ? 'VERIFIED'
        : 'REPLAY';
    const hash = await chainHash(this.prevHash, input, `${source}|${verdict}`);
    this.prevHash = hash;
    const overheadMs = performance.now() - started;

    this.framesReceived++;
    this.overheadMs.push(overheadMs);
    if (this.overheadMs.length > 240) this.overheadMs.shift();

    if (verdict === 'VERIFIED') {
      this.framesVerified++;
      if (label !== 'genuine') this.corruptedToAnalyst++;
      this.arrivals.push({ t: s, outcome: 'ok' });
    } else {
      this.framesRejected++;
      this.arrivals.push({ t: s, outcome: 'fail' });
      const run = this.run;
      if (run && run.rejectMs === null && s >= run.start) run.rejectMs = (s - run.start) * 1000;
    }
    this.pushRow({ seq, hash, source, verdict, label, t: s, overheadMs });

    const block = ++this.blockHeight;
    const short = `${hash.slice(0, 10)}…${hash.slice(-4)}`;
    if (verdict === 'VERIFIED') {
      this.log(`✓ block #${block} ${short} hmac ok`, 'ok');
    } else if (label === 'spoof') {
      this.log(
        `✗ block #${block} forged nonce 0x${seq.toString(16)} · node ${copy.ROGUE_NODE}`,
        'bad',
      );
    } else {
      this.log(`✗ PROOF FAIL #${block} · hmac mismatch · ROGUE-TX`, 'bad');
    }
  }

  private pushRow(row: Omit<LedgerRow, 'id' | 'original'>) {
    this.ledger.unshift({ ...row, id: ++this.rowId, original: row.verdict });
    if (this.ledger.length > LEDGER_ROWS) this.ledger.pop();
  }

  // ---------------------------------------------------------------- detection

  private frameStats(s: number) {
    const recent = this.arrivals.filter((a) => a.t > s - 1.0);
    const n = Math.max(recent.length, 1);
    return {
      lossRate: recent.filter((a) => a.outcome === 'lost').length / n,
      failRate: recent.filter((a) => a.outcome === 'fail').length / n,
    };
  }

  private updateDetectors(s: number) {
    const { PHYSICS, TRUST, AI } = this.detectors;
    const link = this.pass.linkActive && this.current !== null;

    PHYSICS.flag = link && s - this.lastPhysicsViolation <= 0.15;

    const recentFails = this.arrivals.filter((a) => a.outcome === 'fail' && a.t > s - 1.2).length;
    const recentLost = this.arrivals.filter((a) => a.outcome === 'lost' && a.t > s - 1.0).length;
    TRUST.flag = recentFails > 0 || recentLost >= 2;

    if (link && this.current) {
      const stats = this.frameStats(s);
      this.features = featureVector(this.current, stats, this.ai.scales);
      this.aiScore = this.ai.score(this.features);
      this.aiDriver = this.ai.driver(this.features);
      this.recentVectors.push(this.features);
      if (this.recentVectors.length > 60) this.recentVectors.shift();
      let evaluated = 1;
      if (this.heavyBatch) {
        // Heavy batch: re-score the recent window as a backlog would be, for real.
        for (const v of this.recentVectors) this.ai.score(v);
        evaluated += this.recentVectors.length;
      }
      this.aiEvals.push({ t: s, n: evaluated });
    } else {
      this.aiScore = 0.08;
    }
    this.anomaly += (this.aiScore - this.anomaly) * 0.3;
    AI.flag = AI.flag ? this.anomaly >= 0.5 : this.anomaly >= FLAG_AT;

    // Spoof likelihood: fuses physical signatures, the trust result and the model score.
    let z = -3 + 2 * (this.anomaly - 0.5);
    const x = this.current;
    const g = this.gates;
    if (x && g) {
      const residual = x.snrDb - x.snrModelDb;
      if (g.doppler) z += 2.2;
      if (residual > GATES.snrBandDb) z += 1.8;
      if (residual < -GATES.snrBandDb) z -= 2;
      if (g.timing) z += 1.2;
    }
    if (recentFails > 0) z += 3;
    this.spoofLikelihood += (1 / (1 + Math.exp(-z)) - this.spoofLikelihood) * 0.2;

    this.votes = Number(PHYSICS.flag) + Number(TRUST.flag) + Number(AI.flag);

    const run = this.run;
    if (run && !run.ended && s >= run.start) {
      for (const id of ['PHYSICS', 'TRUST', 'AI'] as DetectorId[]) {
        const d = this.detectors[id];
        if (d.flag && d.latencyMs === null) {
          d.latencyMs = (s - run.start) * 1000;
          run.latency[id] = d.latencyMs;
        }
      }
      PHYSICS.evaded = run.kind === 'spoof' && !PHYSICS.flag && (TRUST.flag || AI.flag);
      if (this.votes >= 2 && run.escalatedAt === null) this.escalate(run, s);
    }

    // False-alarm suppression moment: the model flags alone and fusion holds.
    if (this.falseAlarm && s < this.falseAlarm.to + 1.5) {
      if (this.faCallout === 'none' && this.votes === 1 && AI.flag) {
        this.say(copy.TOUR_CALLOUTS.hold, 'fusion', 'warn', 1.6);
        this.faCallout = 'held';
      } else if (this.faCallout === 'held' && this.votes === 0) {
        this.say(copy.TOUR_CALLOUTS.suppressed, 'fusion', 'ok', 2.4);
        this.faCallout = 'cleared';
      }
    }
  }

  private escalate(run: Run, s: number) {
    run.escalatedAt = s;
    run.escalateMs = (s - run.start) * 1000;
    const attack = this.attack;
    if (!attack) return;

    const shown = copy.activeBanner(run.kind, run.escalateMs);
    this.banner = {
      kind: run.kind,
      tone: run.kind === 'jam' ? 'warn' : 'bad',
      ...shown,
      shownAt: s,
      hideAt: null,
    };

    if (run.auto) {
      attack.tResponse = Math.max(run.tTrigger + RESPONSE_DELAY_S[run.kind], s + 1);
    } else {
      attack.tResponse = run.tTrigger + UNANSWERED_END_S;
    }
    if (run.kind === 'hijack') this.compromised = { from: s + 0.2, to: attack.tResponse };

    this.statusLine =
      run.kind === 'jam'
        ? `Jamming detected · forcing fallback routing to ${copy.HANDOVER_STATION}`
        : `Running: ${copy.ATTACK_BUTTONS[run.kind].running} · frames held at the gate`;

    const say = (text: string, sub: string | undefined, target: CalloutTarget, tone: Tone) =>
      this.say({ text, sub }, target, tone, 3.2);
    switch (run.kind) {
      case 'hijack':
        say('Carrier jumped to 8492 MHz', '+14.2 MHz: no orbit produces that', 'telemetry', 'bad');
        say('Proof failures on every rogue frame', undefined, 'ledger', 'bad');
        say('Rogue carrier aimed at Zaghouan', undefined, 'station', 'bad');
        this.log('!! ALERT frequency hijack · carrier +14.2 MHz', 'bad');
        break;
      case 'spoof':
        say('Carrier and RSSI look plausible', 'the physics check is fooled', 'telemetry', 'warn');
        say(`Forged MAC headers from node ${copy.ROGUE_NODE}`, undefined, 'ledger', 'bad');
        say(
          'Quarantine protocols engaged',
          'caught by the trust anchor and the AI model',
          'fusion',
          'bad',
        );
        this.log(`!! QUARANTINE PROTOCOLS ENGAGED · node ${copy.ROGUE_NODE} isolated`, 'bad');
        break;
      case 'jam':
        say('RSSI collapsing to −96.5 dBm', 'driven live by the power slider', 'telemetry', 'warn');
        say('Broadband noise floods Zaghouan', undefined, 'station', 'warn');
        this.log('!! ALERT noise jamming · RSSI collapse', 'warn');
        break;
    }
    this.emit();
  }

  private respond(run: Run, s: number) {
    run.respondedAt = s;
    let handoverS: number | null = null;
    switch (run.kind) {
      case 'hijack':
      case 'spoof':
        this.keyEpoch += 1;
        this.keyFlashAt = s;
        this.quarantineUntil = s + 1.7;
        this.statusLine = `Re-keying · key epoch 0x${this.keyEpoch.toString(16).toUpperCase()}`;
        this.log(
          `quarantine: ${this.framesRejected} frames isolated · epoch 0x${this.keyEpoch.toString(16).toUpperCase()}`,
          'warn',
        );
        this.handshake('re-key');
        break;
      case 'jam':
        this.route = 'MAT';
        this.handoverAt = s;
        handoverS = run.escalatedAt === null ? null : s - run.escalatedAt;
        this.statusLine = `Link restored via ${copy.HANDOVER_STATION}`;
        this.log(`fallback routing → ${copy.HANDOVER_STATION} · downlink restored`, 'ok');
        this.say(
          {
            text: `Fallback routing to ${copy.HANDOVER_STATION}`,
            sub: 'no corrupted frames accepted',
          },
          'sat',
          'ok',
          3,
        );
        break;
    }
    for (const row of this.ledger) {
      if (row.id >= run.firstRowId && (row.verdict === 'MAC FAIL' || row.verdict === 'REPLAY')) {
        row.verdict = 'QUARANTINED';
      }
    }
    if (run.kind === 'hijack' || run.kind === 'spoof') {
      this.say(
        { text: 'Frames held at the provenance gate', sub: 'the pipeline never fails silently' },
        'ledger',
        'ok',
        3,
      );
    }
    const resolved = copy.resolvedBanner(run.kind, this.keyEpoch, handoverS);
    this.banner = { kind: run.kind, tone: 'ok', ...resolved, shownAt: s, hideAt: s + 1.4 };
    this.recoveringUntil = s + 1.1;
    this.emit();
  }

  private updateLifecycle(s: number) {
    const attack = this.attack;
    const run = this.run;
    if (!attack || !run) return;

    if (!run.ended && s >= attack.tResponse) {
      run.ended = true;
      if (run.escalatedAt !== null && run.auto) {
        this.respond(run, s);
      } else if (run.escalatedAt !== null) {
        this.banner = {
          kind: run.kind,
          tone: 'warn',
          ...copy.unansweredBanner,
          shownAt: s,
          hideAt: s + 2.5,
        };
        this.statusLine = 'Ready · standard scenario';
        this.recoveringUntil = s + 1.1;
      } else {
        this.statusLine =
          run.kind === 'jam'
            ? 'Jamming stayed below the detection gate · RSSI held in the band'
            : 'Attack ended without escalation';
      }
      this.compromised = null;
      this.runs.push(run);
      this.emit();
    }

    if (run.ended && s >= attack.tResponse + 0.6) {
      this.attack = null;
      this.run = null;
      if (!this.statusLine.startsWith('Jamming stayed'))
        this.statusLine = 'Ready · standard scenario';
      this.emit();
    }
  }

  private updateState(s: number) {
    const run = this.run;
    let next: SystemState;
    if (run && run.escalatedAt !== null && !run.ended)
      next = run.kind === 'jam' ? 'JAMMING' : 'UNDER ATTACK';
    else if (s < this.recoveringUntil) next = 'RECOVERING';
    else if (this.votes >= 2) next = 'UNDER ATTACK';
    else if (this.votes === 1) next = 'CHECKING';
    else next = 'NOMINAL';
    if (next !== this.state) {
      this.state = next;
      this.emit();
    }
  }

  // ---------------------------------------------------------------- read models

  /** Attack strength 0..1 at the current instant (for visuals). */
  get attackEnvelope(): number {
    return this.attack ? envelope(this.attack, this.s) : 0;
  }

  get quarantined(): boolean {
    return this.s < this.quarantineUntil;
  }

  get compromisedNow(): boolean {
    return (
      this.compromised !== null && this.s >= this.compromised.from && this.s < this.compromised.to
    );
  }

  get linkIntegrity(): number {
    const received = this.arrivals.filter((a) => a.outcome !== 'lost' && a.t > this.s - 3);
    if (received.length === 0) return 1;
    return received.filter((a) => a.outcome === 'ok').length / received.length;
  }

  get verifiedPerSecond(): number {
    return this.arrivals.filter((a) => a.outcome === 'ok' && a.t > this.s - 3).length / 3;
  }

  /** Feature vectors scored by the Isolation Forest over the last second. */
  get vectorsPerSecond(): number {
    return this.aiEvals.reduce((n, e) => n + e.n, 0);
  }

  get medianOverheadMs(): number | null {
    if (this.overheadMs.length === 0) return null;
    const sorted = [...this.overheadMs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  get medianEscalateMs(): number | null {
    const values = this.runs.map((r) => r.escalateMs).filter((v): v is number => v !== null);
    if (this.run?.escalateMs != null) values.push(this.run.escalateMs);
    if (values.length === 0) return null;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  }

  get lastRun(): Run | null {
    return this.run ?? this.runs[this.runs.length - 1] ?? null;
  }

  get demoProgress(): number {
    return this.demo.active ? clamp((this.s - this.demo.t0) / DEMO_LENGTH_S) : 0;
  }

  /** Smoothly interpolated pass state for rendering, optionally `lagS` seconds in the past. */
  visualPass(lagS = 0): PassState {
    return passAt(this.s + this.acc - lagS + this.passOffset);
  }

  get passPhase(): number {
    return ((((this.s + this.passOffset) % PERIOD_S) + PERIOD_S) % PERIOD_S) / PERIOD_S;
  }
}
