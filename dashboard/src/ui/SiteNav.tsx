import { useEffect, useRef } from 'react';

import { pageHref } from './pageHref';

/** The site's pages, in reading order. The dashboard is `/`; the others share pages.html. */
export const PAGES = [
  { path: '/', label: 'Live testbed', title: 'Live testbed' },
  { path: '/signal', label: 'Signals', title: 'The signal database' },
  { path: '/attacks', label: 'Noise attacks', title: 'How an attacker imitates natural noise' },
  { path: '/protection', label: 'Protection', title: 'Our protection: harmless or visible' },
  { path: '/noise', label: 'Explainer video', title: 'Hiding in the noise' },
] as const;

export type PagePath = (typeof PAGES)[number]['path'];

export function SiteNav({ current }: { current: PagePath }) {
  const nav = useRef<HTMLElement>(null);

  // On narrow screens the links scroll sideways: bring the current page into view.
  useEffect(() => {
    const el = nav.current;
    const link = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (el && link && el.scrollWidth > el.clientWidth) {
      el.scrollLeft = link.offsetLeft - (el.clientWidth - link.offsetWidth) / 2;
    }
  }, []);

  return (
    <nav ref={nav} className="site-nav" aria-label="Pages">
      {PAGES.map((page) => (
        <a
          key={page.path}
          href={pageHref(page.path)}
          aria-current={page.path === current ? 'page' : undefined}
        >
          {page.label}
        </a>
      ))}
    </nav>
  );
}
