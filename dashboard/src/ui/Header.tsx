import { useEffect, useState } from 'react';

import { useEngine } from '../engineContext';
import type { SystemState } from '../sim/engine';
import { ScrambleText } from '../reactbits/ScrambleText';
import { utcClock } from './format';
import { passChip } from './orbitText';
import { FleetPicker } from './FleetPicker';
import { DishIcon } from './icons';
import { SiteNav } from './SiteNav';

const PILL: Record<SystemState, string> = {
  NOMINAL: 'ok',
  CHECKING: 'warn',
  'UNDER ATTACK': 'bad',
  JAMMING: 'warn',
  RECOVERING: 'warn',
};

export function Header() {
  const engine = useEngine(4);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const blink = engine.state === 'UNDER ATTACK' || engine.state === 'JAMMING';

  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__mark" aria-hidden="true">
          <DishIcon size={20} />
          <span className="header__wave" />
          <span className="header__wave header__wave--2" />
        </span>
        <span className="header__brandcopy">
          <span className="header__kicker">Earth-observation chain · Track 1</span>
          <span className="header__title">Secure Ground-Link Testbed</span>
        </span>
        <FleetPicker />
      </div>
      <SiteNav current="/" />
      <div className="header__right">
        <span className="header__live">
          <span className="header__live-dot" />
          {engine.demo.active ? 'Demo · four scenarios' : passChip()}
        </span>
        <span className="clock mono" aria-label="UTC time">
          UTC {utcClock(now)}
        </span>
        <span
          className={`pill pill--${PILL[engine.state]} ${blink ? 'pill--blink' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span className="pill__dot" />
          <ScrambleText text={engine.state} />
        </span>
      </div>
    </header>
  );
}
