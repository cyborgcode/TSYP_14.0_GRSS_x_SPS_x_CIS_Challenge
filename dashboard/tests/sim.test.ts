// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { AiModel, FLAG_AT, featureVector, nominalSamples } from '../src/sim/aiModel';
import {
  EmulatedHsm,
  ReplayWindow,
  chainHash,
  createEd25519,
  encodeText,
  genesisRoot,
  encodeHeader,
  importMacKey,
  macInput,
  macSign,
  macVerify,
} from '../src/sim/crypto';
import { Engine } from '../src/sim/engine';
import {
  ALTITUDE_KM,
  ORBIT_PERIOD_S,
  PASS_S,
  passAt,
  snrPredDb,
  timeAfterAos,
} from '../src/sim/geometry';
import { IsolationForest } from '../src/sim/iforest';
import { mulberry32 } from '../src/sim/noise';
import { JAMMED_RSSI_DBM, checkGates, sample, type Attack } from '../src/sim/signals';
import { CHANNEL_HZ, SPAN_HZ, renderSpectrum, spectrumState } from '../src/ui/spectrumModel';

const bytes = (...v: number[]) => new Uint8Array(v);

describe('trust anchor', () => {
  it('verifies a genuine MAC and rejects a single flipped bit', async () => {
    const key = await importMacKey(crypto.getRandomValues(new Uint8Array(32)));
    const header = encodeHeader({ scid: 0x2a, vc: 1, tMs: 1234 });
    const payload = bytes(1, 2, 3, 4);
    const tag = await macSign(key, macInput(header, 7, payload));

    expect(await macVerify(key, macInput(header, 7, payload), tag)).toBe(true);
    expect(await macVerify(key, macInput(header, 8, payload), tag)).toBe(false);
    const flipped = new Uint8Array(tag);
    flipped[0] ^= 1;
    expect(await macVerify(key, macInput(header, 7, payload), flipped)).toBe(false);
  });

  it('derives distinct keys per epoch and rejects frames sealed under another epoch', async () => {
    const hsm = await EmulatedHsm.create();
    const data = macInput(encodeHeader({ scid: 1, vc: 1, tMs: 0 }), 1, bytes(9));
    const tag = await macSign(await hsm.epochKey(0x3f), data);
    expect(await macVerify(await hsm.epochKey(0x3f), data, tag)).toBe(true);
    expect(await macVerify(await hsm.epochKey(0x40), data, tag)).toBe(false);
  });

  it('anti-replay window rejects repeats and anything older than the window', () => {
    const w = new ReplayWindow(64);
    expect(w.accept(100)).toBe(true);
    expect(w.accept(100)).toBe(false);
    expect(w.accept(99)).toBe(true);
    expect(w.accept(200)).toBe(true);
    expect(w.accept(136)).toBe(false);
    expect(w.accept(137)).toBe(true);
  });

  it('chains hashes so one altered frame changes every later link', async () => {
    const a = await chainHash(null, bytes(1), 'm');
    const b = await chainHash(a, bytes(2), 'm');
    const bAltered = await chainHash(await chainHash(null, bytes(9), 'm'), bytes(2), 'm');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).not.toBe(bAltered);
  });
});

describe('genesis root and Ed25519 handshake', () => {
  it('roots the chain in a SHA-256 genesis hash', async () => {
    const root = await genesisRoot('GS-ZAG');
    expect(root).toMatch(/^[0-9a-f]{64}$/);
    expect(await genesisRoot('GS-ZAG')).toBe(root);
    expect(await genesisRoot('GS-MAT')).not.toBe(root);
  });

  it('signs and verifies a handshake challenge with Ed25519', async () => {
    const id = await createEd25519();
    expect(id).not.toBeNull();
    const challenge = encodeText('GS-ZAG|epoch:63');
    const sig = await id!.sign(challenge);
    expect(sig).toHaveLength(64);
    expect(await id!.verify(challenge, sig)).toBe(true);
    expect(await id!.verify(encodeText('GS-ZAG|epoch:64'), sig)).toBe(false);
  });
});

describe('pass geometry', () => {
  it('flies a 542.8 km sun-synchronous LEO orbit', () => {
    expect(ALTITUDE_KM).toBe(542.8);
    expect(ORBIT_PERIOD_S / 60).toBeGreaterThan(95);
    expect(ORBIT_PERIOD_S / 60).toBeLessThan(96);
  });

  it('culminates mid-pass with Doppler crossing zero', () => {
    const rise = passAt(PASS_S * 0.2);
    const top = passAt(PASS_S * 0.5);
    const set = passAt(PASS_S * 0.8);
    expect(top.elevationDeg).toBeGreaterThan(80);
    expect(Math.abs(top.dopplerHz)).toBeLessThan(1000);
    expect(rise.dopplerHz).toBeGreaterThan(50_000);
    expect(set.dopplerHz).toBeLessThan(-50_000);
    expect(snrPredDb(top.rangeKm)).toBeGreaterThan(snrPredDb(rise.rangeKm) + 5);
  });

  it('finds the elevation-mask rise', () => {
    expect(passAt(timeAfterAos(0.01)).linkActive).toBe(true);
    expect(passAt(timeAfterAos(-0.5)).linkActive).toBe(false);
  });
});

describe('physics gates', () => {
  const snrModel = 15;
  const attack = (kind: Attack['kind'], power = 9): Attack => ({
    kind,
    tTrigger: 10,
    tResponse: 100,
    power: () => power,
  });
  const at = (a: Attack | null) =>
    checkGates(sample(12, snrModel, { attacks: a ? [a] : [], falseAlarm: 0 }));

  it('passes nominal traffic', () => {
    for (let s = 0; s < 200; s += 0.05) {
      expect(checkGates(sample(s, snrModel, { attacks: [], falseAlarm: 0 })).any).toBe(false);
    }
  });

  it('flags the hijack, loses frames under strong jamming, and is fooled by stealth spoofing', () => {
    expect(at(attack('hijack')).doppler).toBe(true);
    expect(at(attack('jam', 9)).noFrames).toBe(true);
    expect(at(attack('jam', 3)).any).toBe(false);
    expect(at(attack('spoof')).any).toBe(false);
  });

  it('moves the carrier to ~8492 MHz under hijack and RSSI to −96.5 dBm under jamming', () => {
    const ctx = (a: Attack) => ({ attacks: [a], falseAlarm: 0, dopplerPredHz: 0 });
    const hijacked = sample(12, snrModel, ctx(attack('hijack')));
    expect(hijacked.carrierMHz).toBeGreaterThan(8491.4);
    expect(hijacked.carrierMHz).toBeLessThan(8492.6);
    const jammed = sample(12, snrModel, ctx(attack('jam', 9)));
    expect(Math.abs(jammed.rssiDbm - JAMMED_RSSI_DBM)).toBeLessThan(1);
    const spoofed = sample(12, snrModel, ctx(attack('spoof')));
    expect(spoofed.rssiDbm).toBeLessThan(spoofed.rssiModelDbm - 2);
  });
});

describe('isolation forest', () => {
  it('scores outliers above the centre of a Gaussian cluster', () => {
    const rand = mulberry32(5);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    const data = Array.from({ length: 1000 }, () => [gauss() * 0.3, gauss() * 0.3]);
    const forest = new IsolationForest({ nEstimators: 200, seed: 3 }).fit(data);
    expect(forest.score([2, 2])).toBeGreaterThan(forest.score([0, 0]) + 0.15);
  });
});

describe('AI model', () => {
  const model = new AiModel();
  const clean = { lossRate: 0, failRate: 0 };

  it('keeps the nominal exceedance of the operating point near the 0.6% target', () => {
    const unseen = nominalSamples(3000, 9001.7, 0.43);
    const flagged = unseen.filter(
      (x) => model.score(featureVector(x, clean, model.scales)) >= FLAG_AT,
    );
    expect(flagged.length / unseen.length).toBeLessThan(0.015);
  });

  it('flags the mimic from MAC failures and an EVM burst alone', () => {
    const x = sample(12, 15, { attacks: [], falseAlarm: 0 });
    expect(
      model.score(featureVector(x, { lossRate: 0, failRate: 0.4 }, model.scales)),
    ).toBeGreaterThan(FLAG_AT);
    const burst = sample(12, 15, { attacks: [], falseAlarm: 1 });
    expect(model.score(featureVector(burst, clean, model.scales))).toBeGreaterThan(FLAG_AT);
  });
});

async function runFor(engine: Engine, seconds: number) {
  const steps = Math.round(seconds / 0.05);
  for (let i = 0; i < steps; i++) {
    engine.step();
    await engine.settle();
  }
}

describe('engine scenarios', () => {
  it('stays nominal on a clean pass, verifies every frame and logs the trust anchor', async () => {
    const engine = await Engine.create();
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      engine.step();
      await engine.settle();
      seen.add(engine.state);
    }
    expect(seen.has('UNDER ATTACK')).toBe(false);
    expect(engine.framesVerified).toBeGreaterThan(40);
    expect(engine.framesRejected).toBe(0);
    expect(engine.ledger.every((r) => r.verdict === 'VERIFIED')).toBe(true);
    const log = engine.terminal.map((l) => l.text).join('\n');
    expect(log).toContain(`genesis root ${engine.genesis.slice(0, 24)}`);
    expect(log).toMatch(/✓ block #\d+ [0-9a-f]{10}…[0-9a-f]{4} hmac ok/);
    expect(log).toMatch(/Ed25519 handshake ✓ /);
    expect(engine.handshakes).toBeGreaterThanOrEqual(2);
  });

  it('frequency hijack: escalates, flags proof failures, quarantines and re-keys', async () => {
    const engine = await Engine.create();
    await runFor(engine, 1);
    engine.trigger('hijack');
    await runFor(engine, 1.5);
    expect(engine.state).toBe('UNDER ATTACK');
    expect(engine.detectors.TRUST.flag && engine.detectors.PHYSICS.flag).toBe(true);
    expect(engine.current!.carrierMHz).toBeGreaterThan(8490);
    expect(
      engine.ledger.some((r) => r.verdict === 'MAC FAIL' && r.source.startsWith('ROGUE-TX')),
    ).toBe(true);
    expect(engine.terminal.some((l) => l.text.includes('PROOF FAIL'))).toBe(true);
    await runFor(engine, 5);
    expect(engine.keyEpoch).toBe(0x40);
    expect(engine.ledger.some((r) => r.verdict === 'QUARANTINED')).toBe(true);
    expect(engine.corruptedToAnalyst).toBe(0);
  });

  it('stealth spoofing: physics is evaded, forged nonces from 0x99A2 trigger quarantine', async () => {
    const engine = await Engine.create();
    await runFor(engine, 1);
    engine.trigger('spoof');
    await runFor(engine, 1.2);
    expect(engine.detectors.PHYSICS.flag).toBe(false);
    expect(engine.detectors.PHYSICS.evaded).toBe(true);
    expect(engine.votes).toBeGreaterThanOrEqual(2);
    expect(engine.state).toBe('UNDER ATTACK');
    expect(engine.banner?.headline).toMatch(/Quarantine protocols engaged/);
    expect(engine.ledger.some((r) => r.source === 'NODE 0x99A2')).toBe(true);
    expect(engine.terminal.some((l) => l.text.includes('forged nonce'))).toBe(true);
    expect(engine.corruptedToAnalyst).toBe(0);
  });

  it('noise jamming: RSSI collapses, frames are lost and routing falls back to GS-MAT', async () => {
    const engine = await Engine.create();
    await runFor(engine, 1);
    engine.setPower(9);
    engine.trigger('jam');
    await runFor(engine, 1.5);
    expect(engine.state).toBe('JAMMING');
    expect(engine.current!.rssiDbm).toBeLessThan(-95);
    expect(engine.ledger.some((r) => r.verdict === 'LOST')).toBe(true);
    await runFor(engine, 3);
    expect(engine.route).toBe('MAT');
    expect(engine.terminal.some((l) => l.text.includes('fallback routing → GS-MAT'))).toBe(true);
  });

  it('jam below the gate is never escalated', async () => {
    const engine = await Engine.create();
    await runFor(engine, 1);
    engine.setPower(3);
    engine.trigger('jam');
    await runFor(engine, 4);
    expect(engine.runs.length + (engine.run ? 1 : 0)).toBe(1);
    expect(engine.run?.escalatedAt ?? null).toBeNull();
  });

  it('demo: plays all three scenarios back to back and holds the false alarm', async () => {
    const engine = await Engine.create();
    engine.playDemo();
    const kinds = new Set<string>();
    let held = false;
    for (let i = 0; i < Math.round(43 / 0.05); i++) {
      engine.step();
      await engine.settle();
      if (engine.run) kinds.add(engine.run.kind);
      if (engine.state === 'CHECKING' && engine.detectors.AI.flag && !engine.run) held = true;
    }
    expect([...kinds].sort()).toEqual(['hijack', 'jam', 'spoof']);
    expect(held).toBe(true);
    expect(engine.runs.every((r) => r.escalatedAt !== null && r.respondedAt !== null)).toBe(true);
    expect(engine.corruptedToAnalyst).toBe(0);
  });
});

describe('received spectrum', () => {
  it('shows the downlink channel SNR above a thermal floor on a clean pass', async () => {
    const engine = await Engine.create();
    await runFor(engine, 4);
    const st = spectrumState(engine);
    expect(st.link).toBe(true);
    expect(st.floorDb).toBe(0);
    expect(st.peaks).toHaveLength(1);
    expect(st.peaks[0].db).toBeCloseTo(engine.current!.snrDb, 6);
    expect(st.centreMHz).toBeCloseTo(engine.current!.carrierModelMHz, 6);

    const bins = new Float32Array(400);
    renderSpectrum(st, bins);
    const centre = 10 * Math.log10(bins.slice(195, 205).reduce((a, b) => a + b) / 10);
    const edge = 10 * Math.log10(bins.slice(0, 40).reduce((a, b) => a + b) / 40);
    expect(centre - edge).toBeGreaterThan(st.peaks[0].db - 3);
  });

  it('raises the floor under jamming, puts the hijacker at +14.2 MHz and 0x99A2 on the channel', async () => {
    const jam = await Engine.create();
    await runFor(jam, 1);
    jam.setPower(9);
    jam.trigger('jam');
    await runFor(jam, 1.5);
    expect(spectrumState(jam).floorDb).toBeGreaterThan(5);

    const hijack = await Engine.create();
    await runFor(hijack, 1);
    hijack.trigger('hijack');
    await runFor(hijack, 1.5);
    const rogue = spectrumState(hijack).peaks.find((p) => p.rogue);
    expect(rogue!.hz / 1e6).toBeGreaterThan(13.5);
    expect(rogue!.hz).toBeLessThan(SPAN_HZ / 2);

    const spoof = await Engine.create();
    await runFor(spoof, 1);
    spoof.trigger('spoof');
    await runFor(spoof, 1.2);
    const node = spectrumState(spoof).peaks.find((p) => p.rogue);
    expect(Math.abs(node!.hz)).toBeLessThan(CHANNEL_HZ / 2);
  });
});
