import { useEffect, useState } from 'react';

import { useEngine } from '../engineContext';
import type { SystemState } from '../sim/engine';
import { CARRIER_HZ } from '../sim/geometry';
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
        <span className="header__dish" aria-hidden="true">
          <DishIcon size={22} />
          <span className="header__wave" />
          <span className="header__wave header__wave--2" />
        </span>
        <h1 className="header__title">Secure Ground-Link Testbed</h1>
        <span className="header__divider" aria-hidden="true" />
        <span className="header__subtitle">Earth-observation chain · Track 1</span>
        <FleetPicker />
      </div>
      <SiteNav current="/" />
      <div className="header__right">
        <div className="header__readout">
          <span className="overline">Downlink</span>
          <span className="mono">X-band {(CARRIER_HZ / 1e6).toFixed(1)} MHz</span>
        </div>
        <div className="header__readout">
          <span className="overline">Frame MAC</span>
          <span className="mono">HMAC-SHA256</span>
        </div>
        <span className="mode-chip">
          <span className="mode-chip__dot" />
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
          {engine.state}
        </span>
      </div>
    </header>
  );
}
