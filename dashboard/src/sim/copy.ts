// Copy deck: audited strings, kept in one place so terminology stays consistent.

import type { AttackKind } from './signals';

export const STATION = 'GS-ZAG';
export const STATION_LABEL = 'Zaghouan GS (TN)';
export const STATION_PLACE = 'Zaghouan, Tunisia';
export const HANDOVER_STATION = 'GS-MAT';
export const HANDOVER_PLACE = 'Matera, Italy';
export const SATELLITE = 'LEO-SAT';
export const ROGUE_NODE = '0x99A2';

export const ATTACK_BUTTONS: Record<AttackKind, { label: string; sub: string; running: string }> = {
  hijack: {
    label: 'Frequency Hijacking',
    sub: 'rogue carrier +14.2 MHz',
    running: 'Frequency Hijacking',
  },
  spoof: {
    label: 'Stealth Spoofing',
    sub: `forged MAC · node ${ROGUE_NODE}`,
    running: 'Stealth Spoofing',
  },
  jam: { label: 'Noise Jamming', sub: 'broadband white noise', running: 'Noise Jamming' },
  tamper: {
    label: 'Data Tampering',
    sub: 'bit flips in transit',
    running: 'Data Tampering',
  },
};

/** What each scenario proves, shown on the Simulate Attack panel. */
export const ATTACK_PROOF: Record<AttackKind, string> = {
  spoof: 'RF looks plausible: only the HMAC and nonce checks catch it',
  tamper: 'No RF signature at all: only hash verification catches it',
  hijack: 'Both layers fire: orbit physics and proof failures',
  jam: 'Frames are genuine: only the detector catches it, then fallback',
};

export interface BannerCopy {
  headline: string;
  detail: string;
}

export function activeBanner(kind: AttackKind, ms: number | null): BannerCopy {
  const t = ms === null ? '' : ` in ${Math.round(ms)} ms`;
  switch (kind) {
    case 'hijack':
      return {
        headline: `Frequency hijack detected${t} · carrier at 8492 MHz`,
        detail: `Rogue carrier +14.2 MHz off the ${SATELLITE} downlink · proof failures on every frame`,
      };
    case 'spoof':
      return {
        headline: `Quarantine protocols engaged${t}`,
        detail: `Forged MAC headers and nonces from node ${ROGUE_NODE} · frames isolated at the gate`,
      };
    case 'tamper':
      return {
        headline: `Data tampering detected${t} · hash verification failed`,
        detail: `Payload bits flipped between ${SATELLITE} and ${STATION} · HMAC-SHA256 mismatch on every altered frame`,
      };
    case 'jam':
      return {
        headline: `Noise jamming at ${STATION} · RSSI −96.5 dBm`,
        detail: `Broadband white noise saturating the receiver · forcing fallback routing to ${HANDOVER_STATION}`,
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
    case 'hijack':
      return {
        headline: 'Hijack contained · 0 corrupted frames reached the analyst',
        detail: `Carrier re-locked on ${SATELLITE} · keys rotated to epoch ${e}`,
      };
    case 'spoof':
      return {
        headline: `Node ${ROGUE_NODE} isolated · spoofed frames quarantined`,
        detail: `Ed25519 handshake renewed · keys rotated to epoch ${e}`,
      };
    case 'tamper':
      return {
        headline: 'Tampered frames quarantined · 0 reached the analyst',
        detail: `Retransmission requested · key epoch ${e} unchanged: the relay never had the key`,
      };
    case 'jam':
      return {
        headline: `Fallback routing via ${HANDOVER_STATION}${handoverS === null ? '' : ` in ${handoverS.toFixed(1)} s`}`,
        detail: `${STATION} flagged as jammed · no corrupted frames accepted`,
      };
  }
}

export const unansweredBanner: BannerCopy = {
  headline: 'Attack ended · auto-response was off',
  detail: 'Failing frames were still dropped at the provenance gate',
};

export const TOUR_CALLOUTS = {
  lock: {
    text: `${SATELLITE} downlink locked on ${STATION}`,
    sub: 'pass predicted from orbital elements',
  },
  gate: {
    text: 'Carrier and RSSI vs orbit model',
    sub: 'anything outside the gate breaks orbital physics',
  },
  chain: {
    text: 'Each frame is a SHA-256 block chained to the last',
    sub: 'one altered frame breaks the chain',
  },
  hold: { text: 'Only 1 of 3 detectors flagged it', sub: 'fusion holds instead of alarming' },
  suppressed: { text: 'False alarm suppressed', sub: 'physics and trust anchor both pass' },
  controls: { text: 'Every control drives the telemetry', sub: 'and the 3D link in real time' },
} as const;
