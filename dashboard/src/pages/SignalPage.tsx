import { SignalFacts } from '../ui/explain/SignalFacts';
import { DocPage } from './DocPage';

export function SignalPage() {
  return (
    <DocPage
      path="/signal"
      eyebrow="Downlink"
      lead="One fixed carrier, a power set by the link budget and the ITU-R atmosphere, and a noise floor the station knows. Natural variation sits inside the χ² gate of the physical layer."
    >
      <SignalFacts />
    </DocPage>
  );
}
