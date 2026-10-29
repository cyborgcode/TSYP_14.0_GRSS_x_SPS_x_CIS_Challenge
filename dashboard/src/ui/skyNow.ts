import { useMemo, useRef } from 'react';
import type { SatRec } from 'satellite.js';

import { liveSample, type CatalogSatellite, type SignalSample } from '../sim/signalDb';

export interface SkyPoint {
  sat: CatalogSatellite;
  now: SignalSample;
}

/** Every satellite of the catalogue above the station's horizon at `nowMs`, highest first. */
export function useSkyNow(satellites: CatalogSatellite[], nowMs: number): SkyPoint[] {
  const satrecs = useRef(new Map<number, SatRec>());
  return useMemo(() => {
    const out: SkyPoint[] = [];
    for (const sat of satellites) {
      const now = liveSample(sat, nowMs, satrecs.current);
      if (now) out.push({ sat, now });
    }
    return out.sort((a, b) => b.now.elevationDeg - a.now.elevationDeg);
  }, [satellites, nowMs]);
}
