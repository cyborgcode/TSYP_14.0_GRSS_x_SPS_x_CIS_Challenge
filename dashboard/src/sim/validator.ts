// The decision of the three tiers, as in digital_twin/physics_validator.py: either deterministic
// layer, the data layer (HMAC-SHA256 tag, anti-replay nonce, SHA-256 chain, cleared identity) or
// the physical layer (chi-square against the orbit, kinematic coupling), rejects the frame; the
// statistical layer (Isolation Forest) alone holds it for review; otherwise it is accepted.
// The red-team label never reaches this function.

import { zeroTrust, type Decision, type DetectorResult } from './linkDetector';
import { RESIDUAL_LABEL, type PhysicsResult } from './physicsEngine';
import type { AuthReason, Frame } from './trustAnchor';

const sigma = (z: number) => `${z < 0 ? '−' : '+'}${Math.abs(z).toFixed(1)}σ`;

/** One line on why the physical layer fired. */
export function physicsReason(p: PhysicsResult): string {
  if (p.chiSquareBreach) {
    return (
      `physics: χ² ${p.chiSquare.toFixed(1)} > gate ${p.threshold.toFixed(1)} · ` +
      `${RESIDUAL_LABEL[p.dominant].toLowerCase()} ${sigma(p.normalized[p.dominant])}`
    );
  }
  return `physics: range change disagrees with the Doppler by ${sigma(p.kinematic.z)}`;
}

export function decide(
  claimed: Pick<Frame, 'satellite_id' | 'hw_token'> | null,
  authentic: { ok: boolean; reason: AuthReason } | null,
  physics: PhysicsResult | null,
  detection: DetectorResult | null,
): Decision {
  const reasons = zeroTrust(claimed, authentic, null).reasons.map((r) => `data: ${r}`);
  if (physics?.breach) reasons.push(physicsReason(physics));
  if (reasons.length) {
    return { allow: false, action: 'QUARANTINE_AND_DROP', verdict: 'REJECTED', reasons };
  }
  if (detection?.forest) {
    return {
      allow: false,
      action: 'HOLD_FOR_REVIEW',
      verdict: 'HELD',
      reasons: [
        `statistical: Isolation Forest score ${detection.score.toFixed(3)} > ${detection.threshold.toFixed(3)}`,
      ],
    };
  }
  return { allow: true, action: 'ALLOW_STREAM', verdict: 'ACCEPTED', reasons: [] };
}
