// Testbed engine: one LEO pass over the Zaghouan ground station, framed and sealed for real,
// attacked on demand, and defended by three independent detectors fused by a 2-of-3 vote.
// Every frame runs through browser ports of the Python testbed: trust_anchor.py (HMAC-SHA256
// seal, anti-replay window, SHA-256 chain from the same genesis block), detector.py (physics
// gate + Isolation Forest on orbit residuals) and zero_trust.py. Each frame leaves a packet
// record for the inspection drawer. The trust anchor also renews an Ed25519 handshake with the
// spacecraft; its log is streamed as the trust_anchor.py terminal.
//
// Everything here is emulation. No component transmits or receives RF.

import * as copy from './copy';
import { AiModel, FLAG_AT, featureVector } from './aiModel';
import { FRAME_PERIOD_S } from './constants';
import {
  EmulatedHsm,
  createEd25519,
  encodeText,
  importMacKey,
  toHex,
  type Ed25519Identity,
} from './crypto';
import {
  LinkDetector,
  ROGUE_TOKEN,
  SAT_ID,
  SAT_TOKEN,
  zeroTrust,
  type Decision,
  type DetectorResult,
  type RfMeasurement,
} from './linkDetector';
import {
  TrustAnchorLedger,
  seal,
  type AuthReason,
  type Block,
  type ChainCheck,
  type Frame,
} from './trustAnchor';
import {
  PERIOD_S,
  passAt,
  setPassProfile,
  snrPredDb,
  timeAfterAos,
  type PassState,
} from './geometry';
import { loadPassProfile } from './orbit';
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
export { FRAME_PERIOD_S };
const PACKET_RECORDS = 160;
const CHAIN_CHECK_EVERY_S = 5;
const LEDGER_ROWS = 60;
const RESPONSE_DELAY_S: Record<AttackKind, number> = {
  hijack: 4.8,
  spoof: 2.8,
  jam: 2.8,
  tamper: 2.8,
};
const UNANSWERED_END_S = 8;
const UNDETECTED_END_S = 6;
const ATTACKER_SHARE: Record<AttackKind, number> = {
  hijack: 0.75,
  spoof: 0.75,
  jam: 0,
  tamper: 0.75,
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
  /** satellite_id|sequence|timestamp|hw_token, the frame header as sealed. */
  frameHeader: string;
  payloadHex: string;
  macHex: string;
  epoch: number;
}

/** Everything the station saw and decided about one frame, for the inspection drawer. */
export interface PacketRecord {
  id: number;
  /** Scene time of reception. */
  t: number;
  /** Red-team ground truth, known to the simulator only; no detector reads it. */
  label: FrameLabel;
  /** An attack was active when the frame arrived (genuine frames included). */
  underAttack: boolean;
  source: string;
  /** null when jamming left nothing to decode. */
  frame: Frame | null;
  frameText: string | null;
  mac: string | null;
  expectedMac: string | null;
  frameDigest: string | null;
  keyEpoch: number;
  /** Tampering only: the payload as sealed on board, and the bit flipped in transit. */
  originalPayload: string | null;
  flipped: { byte: number; bit: number } | null;
  auth: { ok: boolean; reason: AuthReason | 'NO_FRAME' };
  block: Pick<Block, 'index' | 'previous_hash' | 'hash'> | null;
  rf: RfMeasurement | null;
  detector: DetectorResult | null;
  decision: Decision;
  authMs: number;
  detectorMs: number;
}

export type StatKey = FrameLabel | 'genuineUnderAttack';

export interface LayerStats {
  frames: number;
  /** Frames that reached the trust anchor (jamming leaves nothing to decode). */
  decoded: number;
  anchor: number;
  physics: number;
  forest: number;
  detector: number;
  blocked: number;
  /** Per run: milliseconds from attack onset to the first blocked attack frame. */
  firstBlockMs: number[];
}

export interface ChainStatus extends ChainCheck {
  full: boolean;
  blocks: number;
  at: number;
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
  firstBlockMs: number | null;
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
  { at: 29.5, run: (e) => e.trigger('tamper', { demo: true }) },
  { at: 35.5, run: (e) => e.trigger('spoof', { demo: true }) },
  { at: 41.5, run: (e) => e.trigger('jam', { demo: true }) },
  { at: 48.5, run: (e) => e.stopDemo() },
];
export const DEMO_LENGTH_S = 48.5;

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
  rejectedMac = 0;
  rejectedNonce = 0;
  framesLost = 0;
  corruptedToAnalyst = 0;
  overheadMs: number[] = [];

  demo: { active: boolean; t0: number; next: number } = { active: false, t0: 0, next: 0 };
  eventCount = 0;

  terminal: TermLine[] = [];
  blockHeight = 0;
  readonly signer: Ed25519Identity | null;
  handshakes = 0;

  /** Browser ports of trust_anchor.py and detector.py. */
  readonly anchor: TrustAnchorLedger;
  readonly linkDetector: LinkDetector;
  packets: PacketRecord[] = [];
  layerStats: Partial<Record<StatKey, LayerStats>> = {};
  heldByZeroTrust = 0;
  chainStatus: ChainStatus | null = null;
  /** Red-team edit of a past ledger block, restored after a few seconds. */
  ledgerTamper: { index: number; until: number } | null = null;

  readonly ai: AiModel;
  private passOffset: number;
  private acc = 0;
  private nextFrameAt = 0;
  private genuineSeq = 1_048_576;
  private arrivals: Arrival[] = [];
  private lastPhysicsViolation = -10;
  private rowId = 0;
  private calloutId = 0;
  private packetId = 0;
  private verifiedUpTo = 0;
  /** verify_chain() runs are serialised, so a status never reflects a half-finished check. */
  private chainChecks: Promise<unknown> = Promise.resolve();
  private nextChainCheckAt = CHAIN_CHECK_EVERY_S;
  private ledgerTamperOriginal: Block['payload'] | null = null;
  private termId = 0;
  private nextHandshakeAt = HANDSHAKE_EVERY_S;
  private queue: Promise<void> = Promise.resolve();
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
    anchor: TrustAnchorLedger,
    signer: Ed25519Identity | null,
  ) {
    this.hsm = hsm;
    this.attackerKey = attackerKey;
    this.ai = ai;
    this.anchor = anchor;
    this.linkDetector = new LinkDetector();
    this.signer = signer;
    const genesis = anchor.genesisRoot;
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
    const [hsm, attackerKey, anchor, signer, profile] = await Promise.all([
      EmulatedHsm.create(),
      importMacKey(crypto.getRandomValues(new Uint8Array(32))),
      TrustAnchorLedger.create(),
      createEd25519(),
      loadPassProfile(),
    ]);
    // The live pass is in place before the models train on nominal passes.
    setPassProfile(profile);
    return new Engine(hsm, attackerKey, new AiModel(), anchor, signer);
  }

  /** Root of the ledger: SHA-256 of the genesis block, identical to trust_anchor.py. */
  get genesis(): string {
    return this.anchor.genesisRoot;
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
      firstBlockMs: null,
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
    if (s >= this.nextChainCheckAt) {
      this.nextChainCheckAt = s + CHAIN_CHECK_EVERY_S;
      // While the red-team edit is live, keep showing the full check that caught it.
      if (!this.ledgerTamper) void this.checkChain(false);
    }
    if (this.ledgerTamper && s >= this.ledgerTamper.until) this.restoreLedger();

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
    const rf: RfMeasurement | null = x
      ? {
          carrierMHz: x.carrierMHz,
          carrierModelMHz: x.carrierModelMHz,
          rssiDbm: x.rssiDbm,
          rssiModelDbm: x.rssiModelDbm,
        }
      : null;
    const underAttack = this.attack !== null && envelope(this.attack, s) > 0.05;

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
      // Nothing to authenticate, but the RF still goes through the detector.
      this.queue = this.queue.then(() => {
        const t0 = performance.now();
        const detection = rf ? this.linkDetector.evaluate(rf) : null;
        this.record({
          t: s,
          label: 'jam',
          underAttack,
          source: 'no signal',
          frame: null,
          frameText: null,
          mac: null,
          expectedMac: null,
          frameDigest: null,
          keyEpoch: this.keyEpoch,
          originalPayload: null,
          flipped: null,
          auth: { ok: false, reason: 'NO_FRAME' },
          block: null,
          rf,
          detector: detection,
          decision: zeroTrust(null, null, detection),
          authMs: 0,
          detectorMs: performance.now() - t0,
        });
      });
      return;
    }

    const kind = this.attack?.kind;
    const active = this.attack && kind && envelope(this.attack, s) > 0.3;
    const roll = this.rand();
    const route = this.route;
    const genuineSource = `${copy.SATELLITE} · VC1 · ${route}`;

    if (active && kind && kind !== 'tamper' && roll < ATTACKER_SHARE[kind]) {
      // The hijacker pushes the next sequence number; node 0x99A2 forges nonces from recent ones.
      const frame: Frame = {
        satellite_id: SAT_ID,
        sequence:
          kind === 'spoof' ? this.genuineSeq - Math.floor(this.rand() * 24) : this.genuineSeq + 1,
        timestamp: Date.now() / 1000,
        hw_token: kind === 'spoof' ? ROGUE_TOKEN : SAT_TOKEN,
        payload: toHex(this.payload()),
      };
      const source = kind === 'spoof' ? `NODE ${copy.ROGUE_NODE}` : 'ROGUE-TX +14.2 MHz';
      this.queue = this.queue.then(async () => {
        const mac = await seal(this.attackerKey, frame);
        await this.verify(frame, mac, source, kind, s, rf, underAttack, null);
      });
      return;
    }

    const epoch = this.keyEpoch;
    const frame: Frame = {
      satellite_id: SAT_ID,
      sequence: ++this.genuineSeq,
      timestamp: Date.now() / 1000,
      hw_token: SAT_TOKEN,
      payload: toHex(this.payload()),
    };
    // Data tampering: a relay in the path flips one payload bit after the satellite sealed it.
    const tampered = active && kind === 'tamper' && roll < ATTACKER_SHARE.tamper;
    this.framesSent++;
    this.queue = this.queue.then(async () => {
      const key = await this.hsm.epochKey(epoch);
      const mac = await seal(key, frame);
      this.txLog.unshift({
        seq: frame.sequence,
        t: s,
        frameHeader: `${frame.satellite_id}|${frame.sequence}|${frame.timestamp.toFixed(6)}|${frame.hw_token}`,
        payloadHex: frame.payload,
        macHex: mac,
        epoch,
      });
      if (this.txLog.length > 8) this.txLog.pop();
      if (tampered) {
        const byte = Math.floor(this.rand() * 16);
        const bit = Math.floor(this.rand() * 8);
        const bytes = frame.payload.match(/../g)!.map((h) => parseInt(h, 16));
        bytes[byte] ^= 1 << bit;
        const received = {
          ...frame,
          payload: bytes.map((b) => b.toString(16).padStart(2, '0')).join(''),
        };
        await this.verify(received, mac, genuineSource, 'tamper', s, rf, underAttack, {
          originalPayload: frame.payload,
          flipped: { byte, bit },
        });
      } else {
        await this.verify(frame, mac, genuineSource, 'genuine', s, rf, underAttack, null);
      }
    });
  }

  private payload(): Uint8Array {
    // 16 bytes, as in ingester.py.
    const p = new Uint8Array(16);
    for (let i = 0; i < p.length; i++) p[i] = Math.floor(this.rand() * 256);
    return p;
  }

  /**
   * Station side, as in the Python testbed: trust_anchor.py (MAC, then nonce, then the chain),
   * detector.py on the RF, then the zero-trust decision. Failing frames stop at the gate.
   */
  private async verify(
    frame: Frame,
    mac: string,
    source: string,
    label: FrameLabel,
    s: number,
    rf: RfMeasurement | null,
    underAttack: boolean,
    tamper: { originalPayload: string; flipped: { byte: number; bit: number } } | null,
  ) {
    const started = performance.now();
    const key = await this.hsm.epochKey(this.keyEpoch);
    const auth = await this.anchor.authenticate(frame, mac, key);
    const block = await this.anchor.append(frame, mac, auth.frameDigest, auth.reason);
    const authMs = performance.now() - started;

    const t0 = performance.now();
    const detection = rf ? this.linkDetector.evaluate(rf) : null;
    const detectorMs = performance.now() - t0;
    const decision = zeroTrust(frame, auth, detection);
    if (decision.allow && rf) this.linkDetector.accept(rf);

    const verdict: Verdict = auth.ok
      ? 'VERIFIED'
      : auth.reason === 'MAC_MISMATCH'
        ? 'MAC FAIL'
        : 'REPLAY';
    this.framesReceived++;
    this.overheadMs.push(authMs);
    if (this.overheadMs.length > 240) this.overheadMs.shift();
    if (verdict === 'VERIFIED') {
      this.framesVerified++;
      if (label !== 'genuine') this.corruptedToAnalyst++;
      this.arrivals.push({ t: s, outcome: 'ok' });
      if (!decision.allow) this.heldByZeroTrust++;
    } else {
      this.framesRejected++;
      if (verdict === 'MAC FAIL') this.rejectedMac++;
      else this.rejectedNonce++;
      this.arrivals.push({ t: s, outcome: 'fail' });
      const run = this.run;
      if (run && run.rejectMs === null && s >= run.start) run.rejectMs = (s - run.start) * 1000;
    }
    this.pushRow({
      seq: frame.sequence,
      hash: block.hash,
      source,
      verdict,
      label,
      t: s,
      overheadMs: authMs,
    });

    this.blockHeight = block.index;
    const short = `${block.hash.slice(0, 10)}…${block.hash.slice(-4)}`;
    if (verdict === 'VERIFIED') {
      this.log(`✓ block #${block.index} ${short} hmac ok`, 'ok');
    } else if (label === 'spoof') {
      this.log(
        `✗ block #${block.index} forged nonce 0x${frame.sequence.toString(16)} · node ${copy.ROGUE_NODE}`,
        'bad',
      );
    } else if (label === 'tamper') {
      this.log(`✗ block #${block.index} HASH MISMATCH · payload altered in transit`, 'bad');
    } else if (verdict === 'REPLAY') {
      this.log(`✗ block #${block.index} stale nonce 0x${frame.sequence.toString(16)}`, 'bad');
    } else {
      this.log(`✗ PROOF FAIL #${block.index} · hmac mismatch · ROGUE-TX`, 'bad');
    }

    this.record({
      t: s,
      label,
      underAttack,
      source,
      frame,
      frameText: `${frame.satellite_id}|${frame.sequence}|${frame.timestamp.toFixed(6)}|${frame.hw_token}|${frame.payload}`,
      mac,
      expectedMac: auth.expectedMac,
      frameDigest: auth.frameDigest,
      keyEpoch: this.keyEpoch,
      originalPayload: tamper?.originalPayload ?? null,
      flipped: tamper?.flipped ?? null,
      auth: { ok: auth.ok, reason: auth.reason },
      block: { index: block.index, previous_hash: block.previous_hash, hash: block.hash },
      rf,
      detector: detection,
      decision,
      authMs,
      detectorMs,
    });
  }

  private record(r: Omit<PacketRecord, 'id'>) {
    this.packets.unshift({ ...r, id: ++this.packetId });
    if (this.packets.length > PACKET_RECORDS) this.packets.pop();

    const key: StatKey = r.label === 'genuine' && r.underAttack ? 'genuineUnderAttack' : r.label;
    const st = (this.layerStats[key] ??= {
      frames: 0,
      decoded: 0,
      anchor: 0,
      physics: 0,
      forest: 0,
      detector: 0,
      blocked: 0,
      firstBlockMs: [],
    });
    st.frames++;
    if (r.frame) st.decoded++;
    if (r.frame && !r.auth.ok) st.anchor++;
    if (r.detector?.physics) st.physics++;
    if (r.detector?.forest) st.forest++;
    if (r.detector?.anomaly) st.detector++;
    if (!r.decision.allow) st.blocked++;

    const run = this.run;
    if (run && r.label === run.kind && !r.decision.allow && run.firstBlockMs === null)
      run.firstBlockMs = Math.max(0, (r.t - run.start) * 1000);
  }

  // ---------------------------------------------------------------- ledger checks

  /** verify_chain() on the browser ledger: incremental by default, from genesis when `full`. */
  checkChain(full: boolean): Promise<ChainStatus> {
    const run = async () => {
      const from = full ? 1 : this.verifiedUpTo + 1;
      const end = this.anchor.chain.length - 1;
      const result = await this.anchor.verifyChain(from);
      if (result.ok) this.verifiedUpTo = Math.max(this.verifiedUpTo, end);
      const status: ChainStatus = { ...result, full, blocks: end, at: this.s };
      this.chainStatus = status;
      this.emit();
      return status;
    };
    const next = this.chainChecks.then(run, run);
    this.chainChecks = next;
    return next;
  }

  /** Red-team demo: edits a past block's recorded verdict, then lets verify_chain() find it. */
  async tamperLedger(): Promise<void> {
    const chain = this.anchor.chain;
    if (this.ledgerTamper || chain.length < 4) return;
    const index = Math.max(1, Math.floor(chain.length / 2));
    const block = chain[index];
    if (typeof block.payload === 'string') return;
    this.ledgerTamperOriginal = block.payload;
    const verdict = block.payload.verdict === 'AUTHENTIC' ? 'MAC_MISMATCH' : 'AUTHENTIC';
    block.payload = { ...block.payload, verdict };
    this.ledgerTamper = { index, until: this.s + 6 };
    this.log(`!! red team edited ledger block #${index}: verdict → ${verdict}`, 'warn');
    const status = await this.checkChain(true);
    if (!status.ok) this.log(`✗ verify_chain(): ${status.message}`, 'bad');
  }

  private restoreLedger() {
    const t = this.ledgerTamper;
    const original = this.ledgerTamperOriginal;
    this.ledgerTamper = null;
    this.ledgerTamperOriginal = null;
    if (!t || !original) return;
    this.anchor.chain[t.index].payload = original;
    this.log(`ledger block #${t.index} restored from the HSM-signed backup`, 'info');
    void this.checkChain(true).then((status) => {
      if (status.ok) this.log('✓ verify_chain(): intact again to genesis', 'ok');
    });
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
      PHYSICS.evaded =
        (run.kind === 'spoof' || run.kind === 'tamper') && !PHYSICS.flag && (TRUST.flag || AI.flag);
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
      case 'tamper':
        say('RF looks clean', 'the physics check sees nothing', 'telemetry', 'warn');
        say('HMAC mismatch: payload altered in transit', undefined, 'ledger', 'bad');
        say(
          'Caught by the trust anchor',
          'the hash no longer matches what the satellite sealed',
          'fusion',
          'bad',
        );
        this.log('!! ALERT data tampering · hash verification failing', 'bad');
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
      case 'tamper':
        // The relay never had the key: no re-key needed, just drop and re-request.
        this.quarantineUntil = s + 1.2;
        this.statusLine = 'Tampered frames quarantined · retransmission requested';
        this.log(
          `quarantine: tampered frames dropped · retransmission requested · key epoch unchanged`,
          'warn',
        );
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
    if (run.kind === 'hijack' || run.kind === 'spoof' || run.kind === 'tamper') {
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
      if (run.firstBlockMs !== null) {
        const st = this.layerStats[run.kind];
        if (st) st.firstBlockMs.push(run.firstBlockMs);
      }
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
