// Tests for the sky-chart geometry: azimuth envelopes, body paths, day ticks, and dark spans.
// Series are hand-built so each expected value can be worked out directly.

import { describe, expect, it } from 'vitest';
import { azimuthEnvelope, bodyPath, darkSpans, dayTicks } from '../src/engine/ribbonGeometry';
import { computeSeries, FrameCache, type SiteSeries } from '../src/engine/visibility';
import { smoothSphereMask } from '../src/engine/horizon';

const HOUR = 3600000;
const DAY = 86400000;
const T0 = Date.UTC(2027, 0, 1);

function makeSeries(n: number, f: (i: number) => Partial<Record<keyof SiteSeries, number>>, stepMs = HOUR): SiteSeries {
  const z = () => new Float32Array(n);
  const s: SiteSeries = {
    startMs: T0, stepMs, n,
    sunAz: z(), sunEl: z(), sunHorizon: z(), sunFrac: z(),
    earthAz: z(), earthEl: z(), earthHorizon: z(), earthFrac: z(),
  };
  for (let i = 0; i < n; i++) {
    const v = f(i);
    for (const k of Object.keys(v) as (keyof SiteSeries)[]) (s[k] as Float32Array)[i] = v[k]!;
  }
  return s;
}

describe('azimuthEnvelope', () => {
  it('has 360 bins centred on 0.5..359.5 and NaN where the body never goes', () => {
    const env = azimuthEnvelope(new Float32Array([10.2]), new Float32Array([5]), 0, 1);
    expect(env.azDeg).toHaveLength(360);
    expect(env.minEl).toHaveLength(360);
    expect(env.maxEl).toHaveLength(360);
    expect(env.azDeg[0]).toBe(0.5);
    expect(env.azDeg[359]).toBe(359.5);
    expect(env.minEl[10]).toBe(5);
    expect(env.maxEl[10]).toBe(5);
    expect(Number.isNaN(env.minEl[9])).toBe(true);
    expect(Number.isNaN(env.maxEl[11])).toBe(true);
  });

  it('takes min and max elevation per bin over [from, to)', () => {
    const az = new Float32Array([10.1, 10.9, 10.5, 11.0, 359.9, 0.0, 10.2]);
    const el = new Float32Array([3, -2, 7, 4, 1, 2, 100]);
    const env = azimuthEnvelope(az, el, 0, 6); // excludes the last sample
    expect(env.minEl[10]).toBe(-2);
    expect(env.maxEl[10]).toBe(7);
    expect(env.minEl[11]).toBe(4);
    expect(env.maxEl[359]).toBe(1);
    expect(env.minEl[0]).toBe(2);
    const sub = azimuthEnvelope(az, el, 1, 3);
    expect(sub.minEl[10]).toBe(-2);
    expect(sub.maxEl[10]).toBe(7);
    expect(Number.isNaN(sub.minEl[11])).toBe(true);
  });

  it('wraps the azimuth into 0..359 bins', () => {
    const env = azimuthEnvelope(new Float32Array([360, 725.5]), new Float32Array([1, 2]), 0, 2);
    expect(env.minEl[0]).toBe(1);
    expect(env.minEl[5]).toBe(2);
  });

  it('gives the Sun a thin band at the south pole', () => {
    const s = computeSeries(smoothSphereMask('p', 'Pole', -90, 0, [2]), 2, Date.UTC(2027, 0, 1), HOUR, 30 * 24, new FrameCache());
    const env = azimuthEnvelope(s.sunAz, s.sunEl, 0, s.n);
    let visited = 0;
    for (let b = 0; b < 360; b++) {
      if (Number.isNaN(env.minEl[b])) continue;
      visited++;
      expect(env.maxEl[b]).toBeGreaterThanOrEqual(env.minEl[b]);
      expect(env.maxEl[b]).toBeLessThan(1.7);
      expect(env.minEl[b]).toBeGreaterThan(-1.7);
    }
    expect(visited).toBeGreaterThan(300); // one lunar day sweeps nearly every azimuth bin
  });
});

describe('bodyPath', () => {
  const s = makeSeries(100, (i) => ({
    sunAz: i, sunEl: i / 10, sunFrac: i / 100, earthAz: 200 + i, earthEl: -i, earthFrac: 1,
  }));
  it('samples from, from + stride, ... below to, with time, position and fraction', () => {
    const p = bodyPath(s, 'sun', 10, 30, 5);
    expect(p.map((q) => q.az)).toEqual([10, 15, 20, 25]);
    expect(p[0]).toMatchObject({ ms: T0 + 10 * HOUR, az: 10, el: 1 });
    expect(p[1].frac).toBeCloseTo(0.15, 6);
    const e = bodyPath(s, 'earth', 0, 3, 1);
    expect(e.map((q) => [q.az, q.el, q.frac])).toEqual([[200, -0, 1], [201, -1, 1], [202, -2, 1]]);
  });
  it('clamps to the series length', () => {
    expect(bodyPath(s, 'sun', 90, 500, 4).map((q) => q.az)).toEqual([90, 94, 98]);
    expect(bodyPath(s, 'sun', 5, 5, 1)).toEqual([]);
  });
});

describe('dayTicks', () => {
  const s = makeSeries(24 * 10, (i) => ({ sunAz: i, sunEl: 1, earthAz: 2 * i, earthEl: 2 }));
  it('gives the position every 24 h after landing, day 0 at landing', () => {
    const t = dayTicks(s, 'sun', 5, 3);
    expect(t.map((d) => d.day)).toEqual([0, 1, 2, 3]);
    expect(t.map((d) => d.az)).toEqual([5, 29, 53, 77]);
    expect(t[2].ms).toBe(T0 + (5 + 48) * HOUR);
    expect(dayTicks(s, 'earth', 0, 2).map((d) => d.az)).toEqual([0, 48, 96]);
  });
  it('stops at the end of the series', () => {
    expect(dayTicks(s, 'sun', 100, 14).map((d) => d.day)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('handles a step that does not divide the day evenly in hours', () => {
    const s6 = makeSeries(40, (i) => ({ sunAz: i }), 6 * HOUR);
    expect(dayTicks(s6, 'sun', 2, 3).map((d) => d.az)).toEqual([2, 6, 10, 14]);
  });
});

describe('darkSpans', () => {
  it('finds a run, interpolating the crossings and the Sun azimuth at each end', () => {
    // frac: up to 9, then 0.75 at 10, 0.25 at 11, 0 for 12..19, 0.25 at 20, 0.75 at 21, 1 after.
    const frac = (i: number) => (i <= 9 ? 1 : i === 10 ? 0.75 : i === 11 ? 0.25 : i <= 19 ? 0 : i === 20 ? 0.25 : i === 21 ? 0.75 : 1);
    const s = makeSeries(40, (i) => ({ sunFrac: frac(i), sunAz: 100 - i }));
    const d = darkSpans(s, 0, 40);
    expect(d).toHaveLength(1);
    expect(d[0].startMs).toBeCloseTo(T0 + 10.5 * HOUR, 3); // .75 -> .25 crosses .5 halfway
    expect(d[0].endMs).toBeCloseTo(T0 + 20.5 * HOUR, 3);
    expect(d[0].azStart).toBeCloseTo(89.5, 4);
    expect(d[0].azEnd).toBeCloseTo(79.5, 4);
    expect(d[0].days).toBeCloseTo(10 / 24, 6);
  });

  it('clips runs at the ends of the window and handles azimuth wrap', () => {
    const s = makeSeries(30, (i) => ({ sunFrac: i < 4 || i >= 26 ? 0 : 1, sunAz: (370 - i * 2) % 360 }));
    const d = darkSpans(s, 0, 30);
    expect(d).toHaveLength(2);
    expect(d[0].startMs).toBe(T0);
    expect(d[0].azStart).toBeCloseTo(10, 4);
    expect(d[0].endMs).toBeCloseTo(T0 + 3.5 * HOUR, 3);
    expect(d[1].endMs).toBe(T0 + 29 * HOUR);
    // Crossing between sample 25 (az 320) and 26 (az 318) at fraction 0.5: az 319.
    expect(d[1].azStart).toBeCloseTo(319, 4);
    // Wrap: az 359 -> 1 should interpolate through 0, not through 180.
    const w = makeSeries(4, (i) => ({ sunFrac: i < 2 ? 1 : 0, sunAz: i === 1 ? 359 : i === 2 ? 1 : 0 }));
    const dw = darkSpans(w, 0, 4);
    expect(dw[0].azStart).toBeCloseTo(0, 4);
  });

  it('respects from/to, the threshold, and returns nothing when the Sun is always up', () => {
    const s = makeSeries(50, (i) => ({ sunFrac: i >= 10 && i < 20 ? 0 : 1, sunAz: i }));
    expect(darkSpans(s, 30, 50)).toEqual([]);
    expect(darkSpans(s, 0, 10)).toEqual([]);
    const part = darkSpans(s, 15, 50);
    expect(part).toHaveLength(1);
    expect(part[0].startMs).toBe(T0 + 15 * HOUR); // already going at `from`
    const strict = makeSeries(10, (i) => ({ sunFrac: i < 5 ? 0.6 : 1, sunAz: i }));
    expect(darkSpans(strict, 0, 10)).toEqual([]);
    expect(darkSpans(strict, 0, 10, 0.7)).toHaveLength(1);
  });

  it('reports a real polar night-length span at a south-pole-adjacent site', () => {
    // At lat -89.5 with a smooth sphere the Sun hovers near the horizon: expect dark spans of days, not hours.
    const s = computeSeries(smoothSphereMask('p', 'Pole', -89.5, 0, [2]), 2, Date.UTC(2027, 5, 1), HOUR, 120 * 24, new FrameCache());
    const spans = darkSpans(s, 0, s.n);
    expect(spans.length).toBeGreaterThan(0);
    expect(Math.max(...spans.map((x) => x.days))).toBeGreaterThan(5);
    for (const x of spans) expect(x.endMs).toBeGreaterThanOrEqual(x.startMs);
    expect(DAY).toBe(86400000);
  });
});
