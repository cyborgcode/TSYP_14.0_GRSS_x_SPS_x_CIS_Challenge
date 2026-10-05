import { useEffect, useRef } from 'react';

import { useEngine } from '../engineContext';
import { EXPLAINER, VIDEO, fmtClock } from '../noise/explainerData';
import { NoiseMimicry } from './explain/NoiseMimicry';
import { SignalFacts } from './explain/SignalFacts';
import { JamIcon, PlayIcon } from './icons';

/** Jammer power that stays inside the 4 dB band in the engine: about 1.2 dB of SNR lost. */
const BELOW_GATE_DB = 3;

/** "Hiding in the noise": how an attacker imitates natural noise, below the dashboard. */
export function NoiseSection() {
  const engine = useEngine(4);
  const restore = useRef<number | null>(null);

  // Put the attack-power slider back once the below-the-gate run is over.
  useEffect(() => {
    if (restore.current !== null && !engine.attack) {
      engine.setPower(restore.current);
      restore.current = null;
    }
  });

  const runBelowGate = () => {
    const previous = engine.power;
    engine.setPower(BELOW_GATE_DB);
    if (engine.trigger('jam')) {
      restore.current = previous;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      engine.setPower(previous);
    }
  };
  const busy = engine.busy || engine.demo.active;

  return (
    <section id="noise" className="explain" aria-labelledby="noise-title">
      <div className="explain__inner">
        <header className="explain__head">
          <p className="explain__eyebrow">Threat deep dive</p>
          <h2 id="noise-title" className="explain__title">
            Hiding in the noise
          </h2>
          <p className="explain__lead">
            Every frame from LEO-SAT reaches Zaghouan under natural noise. A careful attacker shapes
            the attack to look like that noise. Here is the signal we chose, how the imitation
            works, and why our testbed makes it either harmless or visible.
          </p>
          <div className="explain__actions">
            <a className="explain__cta" href={VIDEO.page}>
              <PlayIcon size={14} />
              Watch the explainer · {fmtClock(EXPLAINER.duration)}
            </a>
            <button type="button" className="explain__ghost" onClick={runBelowGate} disabled={busy}>
              <JamIcon size={14} />
              Run a below-the-gate jam
            </button>
          </div>
          <p className="explain__hint">
            Starts Noise Jamming at +{BELOW_GATE_DB} dB: the SNR dips about 1.2 dB, stays inside the
            band, nothing escalates and every frame keeps verifying.
          </p>
        </header>
        <SignalFacts />
        <NoiseMimicry />
      </div>
    </section>
  );
}
