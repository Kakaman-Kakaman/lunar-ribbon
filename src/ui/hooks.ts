// Small UI hooks: element width, and the time cursor with play and pause.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Width in pixels of an element, kept current with a ResizeObserver. */
export function useWidth(ref: RefObject<HTMLElement | null>, fallback = 1100): number {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setW(Math.max(300, Math.floor(el.getBoundingClientRect().width)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export interface Cursor {
  /** Hours after landing. */
  hours: number;
  playing: boolean;
  setHours(h: number): void;
  toggle(): void;
  pause(): void;
}

/**
 * The shared time cursor. While playing it advances so that the whole stay takes about 16 seconds,
 * then loops. maxHours is the end of the longer of the two stays.
 */
export function useCursor(maxHours: number): Cursor {
  const [hours, setHoursState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  const acc = useRef(0);
  const last = useRef(0);

  const setHours = useCallback(
    (h: number) => setHoursState(Math.max(0, Math.min(maxHours, Math.round(h)))),
    [maxHours],
  );

  useEffect(() => {
    if (!playing) return;
    acc.current = hours;
    last.current = performance.now();
    const speed = Math.max(maxHours / 16, 6); // hours per second
    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      acc.current += dt * speed;
      if (acc.current > maxHours) acc.current = 0;
      setHoursState(Math.round(acc.current));
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // Restart only when play state or the length changes; `hours` is read once at the start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, maxHours]);

  // Keep the cursor inside the stay when the stay gets shorter.
  useEffect(() => {
    setHoursState((h) => Math.min(h, maxHours));
  }, [maxHours]);

  return {
    hours: Math.min(hours, maxHours),
    playing,
    setHours,
    toggle: () => setPlaying((p) => !p),
    pause: () => setPlaying(false),
  };
}

/**
 * Height of each ribbon's plot area. Two plans are stacked, so the height is chosen to let both
 * ribbons fit in the window together: about 133 px on a 900 px window, 175 px from a 984 px window, up to 240 px on a tall one,
 * never below 130 px. PAGE_CHROME is everything on the page above and around the two plot areas
 * (header, headline, toolbar, both plan headers, both ribbons' axis rows and captions).
 */
const PAGE_CHROME = 634;
export const plotHeightFor = (windowH: number) => Math.max(130, Math.min(240, Math.floor((windowH - PAGE_CHROME) / 2)));

export function usePlotHeight(): number {
  const [h, setH] = useState(() => plotHeightFor(window.innerHeight));
  useEffect(() => {
    const on = () => setH(plotHeightFor(window.innerHeight));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}
