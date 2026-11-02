import type { ReactNode } from 'react';

import { useSpotlight } from '../reactbits/SpotlightCard';
import { AlertIcon } from './icons';

export function Panel({
  badge,
  title,
  tag,
  alert = false,
  className = '',
  children,
  headerExtra,
  id,
}: {
  badge: string;
  title: string;
  tag: string;
  alert?: boolean;
  className?: string;
  children: ReactNode;
  headerExtra?: ReactNode;
  id?: string;
}) {
  const spotlight = useSpotlight<HTMLElement>();
  return (
    <section
      ref={spotlight.ref}
      onPointerMove={spotlight.onPointerMove}
      className={`panel ${alert ? 'panel--alert' : ''} ${className}`}
      aria-labelledby={`${id ?? badge}-title`}
    >
      <header className="panel__header">
        <span className="panel__badge">{badge}</span>
        <h2 className="panel__title" id={`${id ?? badge}-title`}>
          {title}
        </h2>
        {headerExtra}
        <span className="panel__tag">
          {alert && <AlertIcon size={13} className="panel__alert-icon" />}
          {tag}
        </span>
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}
