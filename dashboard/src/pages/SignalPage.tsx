import { SignalFacts } from '../ui/explain/SignalFacts';
import { DocPage } from './DocPage';

export function SignalPage() {
  return (
    <DocPage
      path="/signal"
      eyebrow="Downlink"
      lead="One fixed carrier, a power set by the link budget, and a noise floor the station knows. Natural variation sits far inside the physics gates."
    >
      <SignalFacts />
    </DocPage>
  );
}
