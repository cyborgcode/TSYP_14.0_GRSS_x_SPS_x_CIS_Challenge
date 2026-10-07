import type { ReactNode } from 'react';

import { DishIcon } from '../ui/icons';
import { PAGES, SiteNav, type PagePath } from '../ui/SiteNav';

/** Shell of every page after the dashboard: fixed top bar, hero, content, previous/next. */
export function DocPage({
  path,
  eyebrow,
  lead,
  aside,
  children,
}: {
  path: PagePath;
  eyebrow: string;
  lead: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const i = PAGES.findIndex((p) => p.path === path);
  const page = PAGES[i];
  const prev = PAGES[i - 1];
  const next = PAGES[i + 1];

  return (
    <>
      <header className="npage-bar">
        <a className="npage-bar__brand" href="/">
          <DishIcon size={22} />
          <span>Secure Ground-Link Testbed</span>
        </a>
        <SiteNav current={path} />
      </header>

      <main className="npage">
        <header className="npage__head">
          <p className="explain__eyebrow">
            {i} / {PAGES.length - 1} · {eyebrow}
          </p>
          <h1 className="explain__title">{page.title}</h1>
          <p className="explain__lead">{lead}</p>
          {aside}
        </header>

        {children}

        <nav className="pager" aria-label="Previous and next page">
          {prev && (
            <a className="pager__link" href={prev.path} rel="prev">
              <span className="pager__dir">← Previous</span>
              <span className="pager__title">{prev.title}</span>
            </a>
          )}
          {next && (
            <a className="pager__link pager__link--next" href={next.path} rel="next">
              <span className="pager__dir">Next →</span>
              <span className="pager__title">{next.title}</span>
            </a>
          )}
        </nav>
      </main>

      <footer className="npage__foot">
        <p>
          Emulation only: nothing here transmits or receives RF. Attacks are software injectors
          acting on synthetic frames; figures come from the testbed’s link model and synthetic
          traffic, to be re-measured on the official reference datasets.
        </p>
        <p>
          Frames are sealed and verified for real with Web Crypto (HMAC-SHA256, SHA-256 hash chain
          from a genesis root, Ed25519 handshakes); the Isolation Forest is trained in the browser
          on nominal passes. Dashboard values marked <em>sample</em> are placeholders until measured
          on the official reference dataset.
        </p>
        <p className="npage__legal">
          Fonts: Space Grotesk, Inter, JetBrains Mono (SIL OFL 1.1) · Land outlines: Natural Earth
          (public domain)
        </p>
      </footer>
    </>
  );
}
