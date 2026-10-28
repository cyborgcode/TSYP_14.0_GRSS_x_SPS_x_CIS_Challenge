import { SignalDatabase } from '../ui/explain/SignalDatabase';
import { DocPage } from './DocPage';

export function SignalPage() {
  return (
    <DocPage
      path="/signal"
      eyebrow="Downlink"
      lead="No fixed signal: every Earth-observation satellite in CelesTrak’s database, propagated with SGP4 to its passes over Zaghouan, each pass turned into the signal the station receives through the X-band link budget and the ITU-R atmosphere. Pick one to see it second by second."
    >
      <SignalDatabase />
    </DocPage>
  );
}
