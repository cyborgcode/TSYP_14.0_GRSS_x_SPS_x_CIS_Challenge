import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import '../index.css';
import '../explain.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { PAGES } from '../ui/SiteNav';
import { AttacksPage } from './AttacksPage';
import { ProtectionPage } from './ProtectionPage';
import { SignalPage } from './SignalPage';
import { VideoPage } from './VideoPage';

const ROUTES = {
  '/signal': SignalPage,
  '/attacks': AttacksPage,
  '/protection': ProtectionPage,
  '/noise': VideoPage,
} as const;

const path = window.location.pathname.replace(/\/+$/, '');
const route = (path in ROUTES ? path : '/signal') as keyof typeof ROUTES;
const Page = ROUTES[route];
const title = PAGES.find((p) => p.path === route)?.title;
document.title = `${title} · Secure Ground-Link Testbed`;

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root was not found in pages.html');
}

createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
