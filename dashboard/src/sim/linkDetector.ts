// Browser port of testbed/detector.py and testbed/zero_trust.py.
//
// Features are residuals against the orbit prediction (measured carrier minus predicted carrier,
// measured RSSI minus link budget) and their change since the last packet the whole pipeline
// accepted. A physics gate flags what no orbit can produce; an Isolation Forest trained on
// nominal passes only flags the rest at a 1 % contamination threshold. Same thresholds as the
// Python module. The red-team label on a frame is never read here.

import { FRAME_PERIOD_S } from './constants';
import { PERIOD_S, passAt, snrPredDb } from './geometry';
import { IsolationForest, quantile } from './iforest';
import { sample } from './signals';

export const MAX_CARRIER_RESIDUAL_MHZ = 0.5;
export const MAX_CARRIER_STEP_MHZ = 0.5;
export const MAX_RSSI_RESIDUAL_DB = 4.0;
export const CONTAMINATION = 0.01;

/** The satellite the station has cleared: its identity in every frame and its hardware token. */
export let SAT_ID = 'TERRASAR-X';
export let SAT_TOKEN = '0x4FE2';
export const ROGUE_TOKEN = '0x99A2';

/** Frame identity of a CelesTrak name: "ARIRANG-5 (KOMPSAT-5)" flies as ARIRANG-5. */
export const satelliteIdFor = (name: string): string =>
  name.split(' (')[0].trim().toUpperCase().replace(/\s+/g, '-');

/** The hardware token registered for a satellite: TerraSAR-X's, else one derived from its NORAD. */
export function tokenFor(noradId: number): string {
  if (noradId === 31698) return '0x4FE2';
  let token = (Math.imul(noradId, 0x9e3779b1) >>> 16) & 0xffff;
  if (token === 0x99a2) token ^= 0x0101; // never the rogue node's
  return `0x${token.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** Clears the satellite the testbed flies, before the engine starts. */
export function setSatelliteIdentity(name: string, noradId: number): void {
  SAT_ID = satelliteIdFor(name);
  SAT_TOKEN = tokenFor(noradId);
}

export interface RfMeasurement {
  carrierMHz: number;
  carrierModelMHz: number;
  rssiDbm: number;
  rssiModelDbm: number;
}

export const FEATURE_NAMES = [
  'carrier residual',
  'power residual',
  'carrier step',
  'power step',
] as const;

export interface DetectorResult {
  /** [carrier residual MHz, RSSI residual dB, carrier step MHz, RSSI step dB]. */
  features: number[];
  physics: boolean;
  physicsReasons: string[];
  /** Isolation Forest anomaly score in (0, 1); higher is more anomalous. */
  score: number;
  /** Score at the 1 % contamination point of the nominal training set. */
  threshold: number;
  /** Share of held-out nominal packets that score below this one. */
  confidence: number;
  forest: boolean;
  anomaly: boolean;
}

function residuals(rf: RfMeasurement): [number, number] {
  return [rf.carrierMHz - rf.carrierModelMHz, rf.rssiDbm - rf.rssiModelDbm];
}

/** Nominal packet sequences over many passes, one per frame period, no attacks. */
function nominalFeatures(count: number, start: number, seedOffset: number): number[][] {
  const out: number[][] = [];
  let prev: [number, number] | null = null;
  let s = start + seedOffset;
  while (out.length < count) {
    const pass = passAt(s);
    if (pass.linkActive) {
      const x = sample(s, snrPredDb(pass.rangeKm, pass.elevationDeg), {
        attacks: [],
        falseAlarm: 0,
        dopplerPredHz: pass.dopplerHz,
      });
      const r = residuals(x);
      out.push(prev ? [r[0], r[1], r[0] - prev[0], r[1] - prev[1]] : [r[0], r[1], 0, 0]);
      prev = r;
    } else {
      prev = null;
    }
    s += FRAME_PERIOD_S;
    if (s > start + seedOffset + PERIOD_S * 400) break;
  }
  return out;
}

export class LinkDetector {
  readonly forest: IsolationForest;
  readonly threshold: number;
  private readonly calibration: number[];
  private reference: [number, number] | null = null;

  constructor(seed = 42) {
    const train = nominalFeatures(3000, 17.3, 0);
    this.forest = new IsolationForest({ nEstimators: 256, sampleSize: 256, seed }).fit(train);
    this.threshold = quantile(
      train.map((f) => this.forest.score(f)),
      1 - CONTAMINATION,
    );
    this.calibration = nominalFeatures(3000, 9001.1, 0)
      .map((f) => this.forest.score(f))
      .sort((a, b) => a - b);
  }

  evaluate(rf: RfMeasurement): DetectorResult {
    const [fr, rr] = residuals(rf);
    const ref = this.reference;
    const features = [fr, rr, ref ? fr - ref[0] : 0, ref ? rr - ref[1] : 0];

    const physicsReasons: string[] = [];
    if (Math.abs(features[0]) > MAX_CARRIER_RESIDUAL_MHZ)
      physicsReasons.push('carrier offset no orbit can produce');
    if (Math.abs(features[2]) > MAX_CARRIER_STEP_MHZ) physicsReasons.push('carrier jump');
    if (Math.abs(features[1]) > MAX_RSSI_RESIDUAL_DB)
      physicsReasons.push('carrier power outside the link-budget band');

    const score = this.forest.score(features);
    const forest = score > this.threshold;
    const physics = physicsReasons.length > 0;
    return {
      features,
      physics,
      physicsReasons,
      score,
      threshold: this.threshold,
      confidence: this.percentile(score),
      forest,
      anomaly: physics || forest,
    };
  }

  /** accept(): only packets the whole pipeline accepted become the velocity reference. */
  accept(rf: RfMeasurement) {
    this.reference = residuals(rf);
  }

  private percentile(score: number): number {
    const c = this.calibration;
    let lo = 0;
    let hi = c.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid] < score) lo = mid + 1;
      else hi = mid;
    }
    return lo / c.length;
  }
}

export interface Decision {
  /** The frame reaches the analyst (accepted, or delivered tagged as degraded). */
  allow: boolean;
  action:
    | 'ALLOW_STREAM'
    | 'DELIVER_DEGRADED'
    | 'HOLD_FOR_REVIEW'
    | 'QUARANTINE_AND_DROP'
    | 'QUARANTINE_LINK';
  /** The digital twin's final decision (digital_twin/decision.py). */
  verdict: 'ACCEPTED' | 'DEGRADED' | 'HELD' | 'REJECTED' | 'QUARANTINED';
  reasons: string[];
}

/** evaluate_access_request() in zero_trust.py: evidence only, never what a frame claims. */
export function zeroTrust(
  claimed: { satellite_id: string; hw_token: string } | null,
  authentic: { ok: boolean; reason: string } | null,
  detection: DetectorResult | null,
): Decision {
  const reasons: string[] = [];
  if (!claimed) reasons.push('no frame decoded');
  else if (claimed.satellite_id !== SAT_ID) reasons.push(`${claimed.satellite_id} is not cleared`);
  else if (claimed.hw_token !== SAT_TOKEN)
    reasons.push(
      `emulated hardware token ${claimed.hw_token} does not match ${SAT_ID} registration`,
    );
  if (authentic && !authentic.ok) reasons.push(`trust anchor: ${authentic.reason}`);
  if (detection?.anomaly) reasons.push('detector: RF anomaly');
  return reasons.length
    ? { allow: false, action: 'QUARANTINE_AND_DROP', verdict: 'REJECTED', reasons }
    : { allow: true, action: 'ALLOW_STREAM', verdict: 'ACCEPTED', reasons: [] };
}
