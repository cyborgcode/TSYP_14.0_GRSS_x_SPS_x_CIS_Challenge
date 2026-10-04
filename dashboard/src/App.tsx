import { useEffect } from 'react';

import { EngineProvider, useEngineCtx } from './engineContext';
import { ControlDeckPanel } from './ui/ControlDeck';
import { Header } from './ui/Header';
import { DishIcon } from './ui/icons';
import { KpiTiles } from './ui/KpiTiles';
import { LedgerPanel } from './ui/Ledger';
import { PacketDrawer } from './ui/PacketDrawer';
import { ResiliencePanel } from './ui/Resilience';
import { TelemetryPanel } from './ui/Telemetry';
import { ThreatMatrixPanel } from './ui/ThreatMatrix';
import { ViewportPanel } from './ui/Viewport';

function Loading() {
  return (
    <div className="loading" role="status">
      <span className="loading__dish">
        <DishIcon size={34} />
      </span>
      <h1 className="loading__title">Secure Ground-Link Testbed</h1>
      <p className="loading__text">
        Training the Isolation Forest on nominal passes · deriving key epochs…
      </p>
      <span className="loading__bar" />
    </div>
  );
}

function Dashboard() {
  const { focus, setFocus } = useEngineCtx();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focus !== 'overview') setFocus('overview');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, setFocus]);

  return (
    <div className="app">
      <Header />
      <main className="main">
        <KpiTiles />
        <div className="grid">
          <div className="grid__col grid__col--main">
            <div className="grid__viewport">
              <ViewportPanel />
            </div>
            <div className="grid__telemetry">
              <TelemetryPanel />
            </div>
          </div>
          <div className="grid__col grid__col--ops">
            <ControlDeckPanel />
            <ResiliencePanel />
          </div>
          <div className="grid__col grid__col--trust">
            <ThreatMatrixPanel />
            <div className="grid__ledger">
              <LedgerPanel />
            </div>
          </div>
        </div>
      </main>
      <PacketDrawer />
      <footer className="footer">
        <p>
          Emulation only: nothing on this page transmits or receives RF. Attacks are software
          injectors acting on synthetic frames inside the testbed.
        </p>
        <p>
          Frames are sealed and verified for real with Web Crypto (HMAC-SHA256, SHA-256 hash chain
          from a genesis root, Ed25519 handshakes); the Isolation Forest is trained in your browser
          on nominal passes. Values marked <em>sample</em> are placeholders until measured on the
          official reference dataset.
        </p>
        <p className="footer__legal">
          Fonts: Space Grotesk, Inter, JetBrains Mono (SIL OFL 1.1) · Land outlines: Natural Earth
          (public domain)
        </p>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <EngineProvider fallback={<Loading />}>
      <Dashboard />
    </EngineProvider>
  );
}
