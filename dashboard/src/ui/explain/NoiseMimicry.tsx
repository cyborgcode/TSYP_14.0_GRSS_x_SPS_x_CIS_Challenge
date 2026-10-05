import type { ComponentType } from 'react';

import { ATTACK_SIGNALS, NATURAL, STEALTH } from '../../sim/linkFacts';
import {
  ForestIcon,
  JamIcon,
  KeyIcon,
  OrbitIcon,
  ShieldIcon,
  SpoofIcon,
  TamperIcon,
} from '../icons';
import { StealthBudget } from './StealthBudget';

interface Technique {
  name: string;
  tone: 'jam' | 'warn' | 'tamper';
  Icon: ComponentType<{ size?: number }>;
  imitates: string;
  how: string;
  gains: string;
  givesAway: string;
}

const TECHNIQUES: Technique[] = [
  {
    name: 'Noise-shaped jamming',
    tone: 'jam',
    Icon: JamIcon,
    imitates: 'thermal noise and rain fade',
    how: 'Transmits Gaussian, white noise across the band and ramps it up slowly, so the floor creeps instead of jumping.',
    gains: 'A lower signal-to-noise ratio with no spike to see on the spectrum.',
    givesAway: `Above ${STEALTH.maxNoiseAboveFloorDb.toFixed(1)} dB over the thermal noise the SNR falls more than ${STEALTH.maxSnrLossDb} dB below the link budget and the physics gate fires. Below that, it costs at most ${STEALTH.maxSnrLossDb} dB and every frame still verifies.`,
  },
  {
    name: 'Fade-mimicking spoofing',
    tone: 'warn',
    Icon: SpoofIcon,
    imitates: 'natural fading and the Doppler track',
    how: `Node 0x99A2 pre-corrects its carrier to the satellite’s Doppler curve and adds artificial fading: the carrier stays within tens of hertz and the power only ${ATTACK_SIGNALS.spoofPowerDropDb} dB low.`,
    gains: 'It passes the physics gate almost every time.',
    givesAway:
      'It cannot produce a valid HMAC-SHA256 tag without the key, it reuses nonces, and its hardware token is wrong. The Isolation Forest also flags its sudden 3 dB step about half the time.',
  },
  {
    name: 'Bit flips disguised as bit errors',
    tone: 'tamper',
    Icon: TamperIcon,
    imitates: 'random bit errors caused by noise',
    how: 'Flips chosen payload bits between the satellite and the station, then recomputes the CRC, which anyone can do.',
    gains: 'The frame looks like a noisy one that passed its checksum. No RF signature at all.',
    givesAway:
      'The HMAC tag, which needs the secret key, no longer matches. One failure looks like weather and is resent; a burst trips two of three detectors and the link is quarantined.',
  },
];

const LAYERS: { name: string; Icon: ComponentType<{ size?: number }>; body: string }[] = [
  {
    name: 'Physics gate',
    Icon: OrbitIcon,
    body: `The orbit predicts the carrier, the received power and the frame timing for every second of the pass. A disguise must stay inside ±${NATURAL.carrierHz.gate} Hz, ±${NATURAL.powerDb.gate} dB and ±${NATURAL.timingUs.gate} µs, where it can cost the link at most ${STEALTH.maxSnrLossDb} dB.`,
  },
  {
    name: 'Isolation Forest',
    Icon: ForestIcon,
    body: 'Trained on clean passes only, it scores each reading together with how fast it changed since the last accepted one: a disguise has to copy the rhythm of nature, not just its level.',
  },
  {
    name: 'Trust anchor',
    Icon: KeyIcon,
    body: 'Every frame carries an HMAC-SHA256 tag made with a secret key. Noise cannot produce one: any changed bit fails the check, and a guessed tag matches one time in 2²⁵⁶.',
  },
  {
    name: 'Zero trust and 2-of-3 fusion',
    Icon: ShieldIcon,
    body: 'A frame is accepted on evidence only. A single failure is dropped and resent; a burst trips two of the three detectors and the link is quarantined.',
  },
];

export function NoiseMimicry() {
  return (
    <>
      <div className="xblock">
        <div className="xblock__head">
          <h3 className="xblock__title">How an attacker imitates natural noise</h3>
          <p className="xblock__lead">
            Natural noise has a signature: Gaussian and white, slow fades, a carrier that follows
            the orbit. A careful attacker copies that signature so the attack blends in.
          </p>
        </div>
        <div className="tech">
          {TECHNIQUES.map(({ name, tone, Icon, imitates, how, gains, givesAway }) => (
            <article key={name} className={`tech__card tech__card--${tone}`}>
              <header className="tech__head">
                <span className="tech__icon">
                  <Icon size={18} />
                </span>
                <div>
                  <h4 className="tech__name">{name}</h4>
                  <p className="tech__imitates">imitates {imitates}</p>
                </div>
              </header>
              <dl className="tech__list">
                <dt>How</dt>
                <dd>{how}</dd>
                <dt>What it buys</dt>
                <dd>{gains}</dd>
                <dt>What gives it away</dt>
                <dd>{givesAway}</dd>
              </dl>
            </article>
          ))}
        </div>
      </div>

      <div className="xblock">
        <div className="xblock__head">
          <h3 className="xblock__title">Our protection: harmless or visible</h3>
          <p className="xblock__lead">
            We do not try to tell every noise from every attack by its look. Each layer makes the
            imitation either too weak to matter or impossible to hide.
          </p>
        </div>
        <div className="defend">
          <StealthBudget />
          <ol className="layers">
            {LAYERS.map(({ name, Icon, body }, i) => (
              <li key={name} className="layers__item">
                <span className="layers__num mono">{i + 1}</span>
                <div>
                  <h4 className="layers__name">
                    <Icon size={15} /> {name}
                  </h4>
                  <p className="layers__body">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
