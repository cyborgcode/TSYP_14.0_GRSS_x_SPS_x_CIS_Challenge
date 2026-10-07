import { BELOW_GATE_DB, BELOW_GATE_HREF } from '../ui/BelowGate';
import { Protection } from '../ui/explain/NoiseMimicry';
import { JamIcon } from '../ui/icons';
import { DocPage } from './DocPage';

export function ProtectionPage() {
  return (
    <DocPage
      path="/protection"
      eyebrow="Defence"
      lead="We do not try to tell every noise from every attack by its look. Each layer makes the imitation either too weak to matter or impossible to hide."
      aside={
        <div className="npage__try">
          <a className="explain__cta" href={BELOW_GATE_HREF}>
            <JamIcon size={14} />
            Run a below-the-gate jam on the live testbed
          </a>
          <p className="explain__hint">
            Starts Noise Jamming at +{BELOW_GATE_DB} dB: the SNR dips about 1.2 dB, stays inside the
            band, nothing escalates and every frame keeps verifying.
          </p>
        </div>
      }
    >
      <Protection />
    </DocPage>
  );
}
