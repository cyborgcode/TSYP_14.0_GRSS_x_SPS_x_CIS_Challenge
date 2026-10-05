// The explainer video's files and timings (written by explainer/narrate.py and render.mjs).

import timeline from './explainer.json';

export const EXPLAINER = timeline;

export const VIDEO = {
  src: '/media/hiding-in-the-noise.mp4',
  webm: '/media/hiding-in-the-noise.webm',
  poster: '/media/hiding-in-the-noise.jpg',
  captions: '/media/hiding-in-the-noise.en.vtt',
  page: '/noise',
} as const;

/** 163.7 → "2:43". */
export const fmtClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
