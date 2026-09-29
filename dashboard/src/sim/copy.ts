// Copy deck: audited strings, kept in one place so terminology stays consistent.

import type { AttackKind } from './signals';

export const STATION = 'GS-LAB';
export const STATION_LABEL = 'GS-LAB (testbed)';
export const HANDOVER_STATION = 'GS-KIR';
export const SATELLITE = 'S2A';

export const ATTACK_BUTTONS: Record<AttackKind, { label: string; sub: string; running: string }> = {
  spoof: { label: 'Spoofed frame', sub: 'standard scenario', running: 'Spoofed frame' },
  replay: { label: 'Replayed pass', sub: 'captured S2A pass', running: 'Replayed pass' },
  jam: { label: 'RF jamming', sub: 'availability attack', running: 'RF jamming' },
  mimic: { label: 'Doppler mimic', sub: 'evasion attempt', running: 'Doppler mimic' },
};

export interface BannerCopy {
  headline: string;
  detail: string;
}

export function activeBanner(kind: AttackKind, ms: number | null): BannerCopy {
  const t = ms === null ? '' : ` in ${Math.round(ms)} ms`;
  switch (kind) {
    case 'spoof':
      return {
        headline: `Spoofed ground-link frame · detected${t}`,
        detail: 'UNKNOWN-TX → GS-LAB, claiming to be S2A · frames held at the gate',
      };
    case 'replay':
      return {
        headline: `Replayed pass rejected${t}`,
        detail: 'Sequence numbers reused · timing skew +850 µs · Doppler off-model',
      };
    case 'jam':
      return {
        headline: 'RF jamming at GS-LAB · SNR below the link budget',
        detail: 'Frames lost · switching the S2A downlink to GS-KIR',
      };
    case 'mimic':
      return {
        headline: 'Evasion attempt caught · 2 of 3 detectors',
        detail: 'Doppler mimicked, but the MAC failed and the AI model flagged it',
      };
  }
}

export function resolvedBanner(
  kind: AttackKind,
  epoch: number,
  handoverS: number | null,
): BannerCopy {
  const e = `0x${epoch.toString(16).toUpperCase()}`;
  switch (kind) {
    case 'spoof':
      return {
        headline: 'Threat contained · 0 corrupted frames reached the analyst',
        detail: `GS-LAB link quarantined · keys rotated to epoch ${e}`,
      };
    case 'replay':
      return {
        headline: 'Replay blocked · anti-replay window held',
        detail: 'Recorded frames discarded before decoding',
      };
    case 'jam':
      return {
        headline: `Link restored via GS-KIR${handoverS === null ? '' : ` in ${handoverS.toFixed(1)} s`}`,
        detail: 'GS-LAB flagged as jammed · no corrupted frames accepted',
      };
    case 'mimic':
      return {
        headline: 'Threat contained · spoofed frames dropped',
        detail: `GS-LAB quarantined · keys rotated to epoch ${e}`,
      };
  }
}

export const unansweredBanner: BannerCopy = {
  headline: 'Attack ended · auto-response was off',
  detail: 'Failing frames were still dropped at the provenance gate',
};

export const TOUR_CALLOUTS = {
  lock: { text: 'S2A downlink locked on GS-LAB', sub: 'pass predicted from orbital elements' },
  gate: {
    text: 'Measured vs orbit model',
    sub: 'anything outside the gate breaks orbital physics',
  },
  chain: {
    text: 'Each frame is hash-chained to the last',
    sub: 'one altered frame breaks the chain',
  },
  hold: { text: 'Only 1 of 3 detectors flagged it', sub: 'fusion holds instead of alarming' },
  suppressed: { text: 'False alarm suppressed', sub: 'physics and trust anchor both pass' },
  controls: { text: 'Every control drives the telemetry', sub: 'and the 3D link in real time' },
} as const;
