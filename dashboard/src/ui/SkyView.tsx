import { useMemo } from 'react';

import type { SignalSample } from '../sim/signalDb';
import type { SkyPoint } from './skyNow';

const SIZE = 320;
const C = SIZE / 2;
const R = SIZE / 2 - 26;

/** Polar sky over Zaghouan: zenith in the centre, the horizon on the rim, north up. */
const project = (azDeg: number, elDeg: number) => {
  const r = (R * (90 - Math.max(0, elDeg))) / 90;
  const a = (azDeg * Math.PI) / 180;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
};

export function SkyView({
  points,
  selected,
  track,
  onPick,
  label = 'Satellites above Zaghouan now',
}: {
  points: SkyPoint[];
  /** NORAD number of the highlighted satellite. */
  selected: number | null;
  /** The highlighted satellite's pass, drawn as its path across the sky. */
  track?: SignalSample[];
  onPick?: (noradId: number) => void;
  label?: string;
}) {
  const path = useMemo(() => {
    if (!track || track.length < 2) return null;
    return track
      .map((s, i) => {
        const p = project(s.azimuthDeg, s.elevationDeg);
        return `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join('');
  }, [track]);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="sky"
      role="img"
      aria-label={`${label}: ${points.length} ${points.length === 1 ? 'satellite' : 'satellites'}${points.length ? `, highest ${points[0].sat.name} at ${points[0].now.elevationDeg.toFixed(0)} degrees` : ''}`}
    >
      <circle cx={C} cy={C} r={R} className="sky__horizon" />
      {[30, 60].map((el) => (
        <circle key={el} cx={C} cy={C} r={(R * (90 - el)) / 90} className="sky__ring" />
      ))}
      <circle cx={C} cy={C} r={(R * (90 - 10)) / 90} className="sky__mask" />
      <line x1={C - R} x2={C + R} y1={C} y2={C} className="sky__ring" />
      <line x1={C} x2={C} y1={C - R} y2={C + R} className="sky__ring" />
      {(
        [
          ['N', C, C - R - 9],
          ['E', C + R + 10, C + 4],
          ['S', C, C + R + 17],
          ['W', C - R - 10, C + 4],
        ] as const
      ).map(([t, x, y]) => (
        <text key={t} x={x} y={y} textAnchor="middle" className="sky__cardinal">
          {t}
        </text>
      ))}
      <text x={C + 3} y={C - (R * 60) / 90 + 12} className="sky__el">
        30°
      </text>
      <text x={C + 3} y={C - (R * 30) / 90 + 12} className="sky__el">
        60°
      </text>
      {path && <path d={path} className="sky__track" pathLength={1} />}
      {points.map(({ sat, now }) => {
        const p = project(now.azimuthDeg, now.elevationDeg);
        const on = sat.noradId === selected;
        return (
          <g
            key={sat.noradId}
            className={`sky__sat ${on ? 'is-on' : ''} ${onPick ? 'is-pickable' : ''}`}
            style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            onClick={onPick ? () => onPick(sat.noradId) : undefined}
          >
            <title>
              {`${sat.name} · elevation ${now.elevationDeg.toFixed(1)}° · azimuth ${now.azimuthDeg.toFixed(0)}°`}
            </title>
            {on && <circle r={11} className="sky__halo" />}
            <circle r={onPick ? 9 : 0} className="sky__hit" />
            <circle r={on ? 5 : 3.2} className="sky__dot" />
            {on && (
              <text x={9} y={-8} className="sky__name">
                {sat.name}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
