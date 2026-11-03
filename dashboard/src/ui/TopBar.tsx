import { useEffect, useState } from 'react';

import { utcClock } from './format';
import { DishIcon } from './icons';
import { SiteNav, type PagePath } from './SiteNav';

/** The one top bar of every page, identical on all of them: the brand, the pages, UTC. */
export function TopBar({ current }: { current: PagePath }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="topbar">
      <a className="topbar__brand" href="/">
        <span className="topbar__mark" aria-hidden="true">
          <DishIcon size={19} />
        </span>
        <span className="topbar__copy">
          <span className="topbar__kicker">Earth-observation chain · Track 1</span>
          <span className="topbar__title">Secure Ground-Link Testbed</span>
        </span>
      </a>
      <SiteNav current={current} />
      <span className="topbar__clock mono" aria-label="UTC time">
        UTC {utcClock(now)}
      </span>
    </header>
  );
}
