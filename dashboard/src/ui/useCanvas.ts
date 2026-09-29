import { useEffect, useRef } from 'react';

export type DrawFn = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  timeS: number,
) => void;

/** Sizes a canvas to its box at device pixel ratio and redraws it every animation frame. */
export function useCanvasLoop(draw: DrawFn, fps = 60) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = 0;
    const interval = 1000 / fps;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < interval - 1) return;
      last = now;
      if (width > 0 && height > 0) {
        ctx.clearRect(0, 0, width, height);
        drawRef.current(ctx, width, height, now / 1000);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [fps]);

  return ref;
}

export const COLORS = {
  bg1: '#0A1019',
  bg2: '#0E1621',
  line: '#1E2B3A',
  text0: '#ECF2F8',
  text1: '#A3B2C4',
  text2: '#7D8EA3',
  text3: '#404F61',
  accent: '#4CC9F0',
  ice: '#CEE6FF',
  ok: '#34D399',
  warn: '#FBBF24',
  bad: '#F8485E',
};

export const FONT_DATA = '"JetBrains Mono", ui-monospace, monospace';
export const FONT_UI = 'Inter, system-ui, sans-serif';

export function hatch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = `${color}14`;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = `${color}66`;
  ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 6) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}
