import { useEffect, useRef, useState } from 'react';

/** The current time, refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** `target`, eased over `ms` whenever it changes: numbers that roll instead of jumping. */
export function useTween(target: number, ms = 600): number {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const shown = useRef(target);
  useEffect(() => {
    if (!Number.isFinite(target)) {
      shown.current = target;
      setValue(target);
      return;
    }
    if (
      !Number.isFinite(shown.current) ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      shown.current = target;
      setValue(target);
      return;
    }
    from.current = shown.current;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - (1 - k) ** 3;
      shown.current = from.current + (target - from.current) * e;
      setValue(shown.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}
