import { useEffect, useMemo, useState } from 'react';

import { MASK_ELEVATION_DEG } from '../../sim/geometry';
import { MIN_PEAK_ELEVATION_DEG } from '../../sim/orbit';
import {
  HORIZON_HOURS,
  buildSignalDb,
  loadCatalog,
  signalCurve,
  type Catalog,
  type CatalogSatellite,
  type PassSignal,
  type SignalSample,
} from '../../sim/signalDb';
import { MINUS } from '../format';
import { SignalFacts } from './SignalFacts';

const PEAK_FILTERS = [MASK_ELEVATION_DEG, MIN_PEAK_ELEVATION_DEG, 30] as const;

const utc = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const sameUtcDay = (a: number, b: number) =>
  new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
const weekday = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
const dbm = (v: number) => `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(1)}`;

function sourceLine(c: Catalog): string {
  const at = new Date(c.fetchedUtc);
  const when = `${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${utc(at.getTime())} UTC`;
  switch (c.source) {
    case 'celestrak':
      return `Live from CelesTrak · downloaded ${when}`;
    case 'cache':
      return `CelesTrak unreachable · last download kept in this browser, ${when}`;
    case 'snapshot':
      return `CelesTrak unreachable · snapshot of CelesTrak built into the site, ${when}`;
  }
}

/** The pass the testbed replays: TerraSAR-X's next one above 10°, else the next in the list. */
function defaultPick(signals: PassSignal[]): PassSignal | null {
  return (
    signals.find((s) => s.testbed && s.maxElevationDeg >= MIN_PEAK_ELEVATION_DEG) ??
    signals.find((s) => s.maxElevationDeg >= MIN_PEAK_ELEVATION_DEG) ??
    signals[0] ??
    null
  );
}

// ---------------------------------------------------------------- the selected pass, over time

const CW = 360;
const CH = 178;
const PAD = { l: 52, r: 12, t: 34, b: 28 };

interface Track {
  label: string;
  unit: string;
  value: (s: SignalSample) => number;
  fmt: (v: number) => string;
}

const signed = (v: number) => {
  const r = Math.round(v);
  return r === 0 ? '0' : `${r < 0 ? MINUS : '+'}${Math.abs(r)}`;
};

const TRACKS: Track[] = [
  { label: 'Elevation', unit: '°', value: (s) => s.elevationDeg, fmt: (v) => v.toFixed(0) },
  { label: 'Doppler', unit: 'kHz', value: (s) => s.dopplerHz / 1e3, fmt: signed },
  { label: 'Received power', unit: 'dBm', value: (s) => s.rxDbm, fmt: (v) => dbm(v) },
];

/** One quantity of the selected pass against time, horizon to horizon. */
function TrackChart({
  track,
  samples,
  sig,
}: {
  track: Track;
  samples: SignalSample[];
  sig: PassSignal;
}) {
  const values = samples.map(track.value);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) hi = lo + 1;
  const top = hi;
  const bottom = lo;
  const pad = (hi - lo) * 0.08;
  lo -= pad;
  hi += pad;
  const W = CW - PAD.l - PAD.r;
  const H = CH - PAD.t - PAD.b;
  const x = (t: number) => PAD.l + ((t - sig.aosMs) / (sig.losMs - sig.aosMs)) * W;
  const y = (v: number) => PAD.t + H - ((v - lo) / (hi - lo)) * H;
  const path = samples
    .map((s, k) => `${k ? 'L' : 'M'}${x(s.tMs).toFixed(1)},${y(track.value(s)).toFixed(1)}`)
    .join('');
  const mid = sig.aosMs + (sig.losMs - sig.aosMs) / 2;
  const hms = (t: number) => new Date(t).toISOString().slice(11, 19);
  return (
    <svg
      viewBox={`0 0 ${CW} ${CH}`}
      role="img"
      aria-label={`${track.label} from ${track.fmt(values[0])} to ${track.fmt(values[values.length - 1])} ${track.unit}, between ${track.fmt(bottom)} and ${track.fmt(top)}`}
    >
      <text x={PAD.l} y={18} className="fig-label">
        {track.label} ({track.unit})
      </text>
      {[top, (top + bottom) / 2, bottom].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={CW - PAD.r} y1={y(v)} y2={y(v)} className="fig-grid" />
          <text x={PAD.l - 7} y={y(v) + 4} textAnchor="end" className="fig-tick">
            {track.fmt(v)}
          </text>
        </g>
      ))}
      <path d={path} className="sigdb__line" />
      <text x={PAD.l} y={CH - 6} className="fig-tick">
        {hms(sig.aosMs)}
      </text>
      <text x={x(mid)} y={CH - 6} textAnchor="middle" className="fig-tick">
        {hms(mid)}
      </text>
      <text x={CW - PAD.r} y={CH - 6} textAnchor="end" className="fig-tick">
        {hms(sig.losMs)}
      </text>
    </svg>
  );
}

function SignalCurves({ sat, sig }: { sat: CatalogSatellite; sig: PassSignal }) {
  const samples = useMemo(
    () => signalCurve(sat, sig.aosMs, sig.losMs, 2),
    [sat, sig.aosMs, sig.losMs],
  );
  return (
    <figure className="figure sigdb__curves">
      <figcaption className="figure__title">
        {sig.name} over Zaghouan, {utc(sig.aosMs)} → {utc(sig.losMs)} UTC: the signal second by
        second
      </figcaption>
      <div className="sigdb__tracks">
        {TRACKS.map((track) => (
          <TrackChart key={track.label} track={track} samples={samples} sig={sig} />
        ))}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------- the database

export function SignalDatabase() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [signals, setSignals] = useState<PassSignal[] | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [builtAt, setBuiltAt] = useState(0);
  const [minPeak, setMinPeak] = useState<number>(MIN_PEAK_ELEVATION_DEG);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const c = await loadCatalog();
      if (!alive) return;
      setCatalog(c);
      const now = Date.now();
      const db = await buildSignalDb(c, now, HORIZON_HOURS, (done, total) => {
        if (alive) setProgress([done, total]);
      });
      if (!alive) return;
      setBuiltAt(now);
      setSignals(db);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const rows = (signals ?? []).filter(
    (s) =>
      s.maxElevationDeg >= minPeak &&
      (!q || s.name.toLowerCase().includes(q) || String(s.noradId).includes(q)),
  );
  const selected =
    (picked && signals?.find((s) => s.id === picked)) || (signals ? defaultPick(signals) : null);
  const sat = selected && catalog?.satellites.find((s) => s.noradId === selected.noradId);
  const satellites = new Set(rows.map((s) => s.noradId)).size;

  return (
    <div className="sigdb">
      <div className="sigdb__status" role="status">
        <span
          className={`sigdb__dot ${catalog?.source === 'celestrak' ? 'is-live' : catalog ? 'is-offline' : ''}`}
          aria-hidden="true"
        />
        {catalog ? (
          <span>
            {sourceLine(catalog)} · {catalog.satellites.length} Earth-observation satellites
            {signals
              ? ` · ${signals.length} passes over Zaghouan in the next ${HORIZON_HOURS} h`
              : ` · propagating ${progress[0]}/${progress[1] || catalog.satellites.length} with SGP4…`}
          </span>
        ) : (
          <span>Loading the element sets from CelesTrak…</span>
        )}
      </div>

      <section className="sigdb__table-wrap" aria-label="Signal database">
        <div className="sigdb__bar">
          <label className="sigdb__search">
            <span className="sr-only">Filter by satellite name or NORAD number</span>
            <input
              type="search"
              placeholder="Satellite or NORAD number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="seg" role="group" aria-label="Lowest culmination">
            {PEAK_FILTERS.map((el) => (
              <button
                key={el}
                type="button"
                className={`seg__btn ${minPeak === el ? 'seg__btn--on' : ''}`}
                aria-pressed={minPeak === el}
                onClick={() => setMinPeak(el)}
              >
                ≥ {el}°
              </button>
            ))}
          </div>
          <span className="sigdb__count mono">
            {signals ? `${rows.length} signals · ${satellites} satellites` : '…'}
          </span>
        </div>
        <div className="sigdb__scroll">
          <table className="sigdb__table">
            <thead>
              <tr>
                <th scope="col">Satellite</th>
                <th scope="col">Rises (UTC)</th>
                <th scope="col">Max el.</th>
                <th scope="col">Above mask</th>
                <th scope="col">Doppler</th>
                <th scope="col">Received power</th>
                <th scope="col">SNR</th>
              </tr>
            </thead>
            <tbody>
              {signals === null && (
                <tr>
                  <td colSpan={7} className="sigdb__empty">
                    Computing every pass over Zaghouan…
                  </td>
                </tr>
              )}
              {signals !== null && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="sigdb__empty">
                    No pass matches this filter in the next {HORIZON_HOURS} h.
                  </td>
                </tr>
              )}
              {rows.map((s) => {
                const on = selected?.id === s.id;
                const doppler = Math.max(Math.abs(s.dopplerHz.min), Math.abs(s.dopplerHz.max));
                return (
                  <tr key={s.id} className={on ? 'is-on' : ''} aria-selected={on}>
                    <th scope="row">
                      <button type="button" onClick={() => setPicked(s.id)}>
                        {s.name}
                        {s.testbed && <span className="sigdb__tag">testbed</span>}
                      </button>
                    </th>
                    <td className="mono">
                      {sameUtcDay(s.aosMs, builtAt) ? '' : `${weekday(s.aosMs)} `}
                      {utc(s.aosMs)}
                    </td>
                    <td className="mono">{s.maxElevationDeg.toFixed(1)}°</td>
                    <td className="mono">{((s.losMs - s.aosMs) / 60_000).toFixed(1)} min</td>
                    <td className="mono">±{(doppler / 1e3).toFixed(0)} kHz</td>
                    <td className="mono">
                      {dbm(s.rxDbm.min)} → {dbm(s.rxDbm.max)} dBm
                    </td>
                    <td className="mono">
                      {s.snrDb.min.toFixed(1)} → {s.snrDb.max.toFixed(1)} dB
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="sigdb__note">
          Orbits are CelesTrak’s latest element sets, propagated with SGP4. CelesTrak publishes
          orbits, not radios, so every satellite is received on the station’s X-band channel (8477.8
          MHz) through the same link budget and ITU-R P.618 atmosphere: the signals differ by their
          geometry, which is what the physical layer checks. The testbed replays the TerraSAR-X pass
          marked <span className="sigdb__tag">testbed</span>.
        </p>
      </section>

      {selected && sat && (
        <section className="sigdb__detail" aria-label={`Signal of ${selected.name}`}>
          <SignalCurves sat={sat} sig={selected} />
          <SignalFacts sig={selected} />
        </section>
      )}
    </div>
  );
}
