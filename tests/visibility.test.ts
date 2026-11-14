// Tests for the skyline table (horizon.ts) and for sun/Earth visibility over time (visibility.ts),
// including checks of the computed Sun and Earth tracks against NASA JPL Horizons values.

import { describe, expect, it } from 'vitest';
import { horizonAt, smoothSphereMask, type HorizonMask } from '../src/engine/horizon';
import {
  FrameCache,
  computeSeries,
  discFractionAbove,
  intervalsAbove,
  timeToNextDrop,
  timeToNextRise,
} from '../src/engine/visibility';
import { evaluate, PROFILES } from '../src/engine/mission';

const HOUR = 3600000;
const DAY = 86400000;
const R2D = 180 / Math.PI;

describe('horizonAt', () => {
  const profile = [0, 10, 20, 30]; // step 90 degrees
  it('returns table entries at exact steps', () => {
    expect(horizonAt(profile, 90, 0)).toBe(0);
    expect(horizonAt(profile, 90, 180)).toBe(20);
  });
  it('interpolates linearly between entries', () => {
    expect(horizonAt(profile, 90, 45)).toBeCloseTo(5, 10);
    expect(horizonAt(profile, 90, 135)).toBeCloseTo(15, 10);
  });
  it('wraps at 360 and handles negative azimuths', () => {
    expect(horizonAt(profile, 90, 315)).toBeCloseTo(15, 10); // halfway between 30 and 0
    expect(horizonAt(profile, 90, 360)).toBe(0);
    expect(horizonAt(profile, 90, 405)).toBeCloseTo(5, 10);
    expect(horizonAt(profile, 90, -45)).toBeCloseTo(15, 10);
  });
});

describe('smoothSphereMask', () => {
  it('fills every azimuth with the horizon dip for each height', () => {
    const m = smoothSphereMask('t', 'Test', -85, 10, [2, 10]);
    expect(m.terrain).toBe('smooth-sphere');
    expect(m.groundElevM).toBeNull();
    expect(m.azStepDeg).toBe(0.5);
    expect(m.heightsM).toEqual([2, 10]);
    expect(m.horizonDeg['2']).toHaveLength(720);
    const dip = (h: number) => -Math.acos(1737.4 / (1737.4 + h / 1000)) * R2D;
    expect(m.horizonDeg['2'][0]).toBeCloseTo(dip(2), 12);
    expect(m.horizonDeg['10'][719]).toBeCloseTo(dip(10), 12);
    expect(new Set(m.horizonDeg['10']).size).toBe(1);
    expect(m.horizonDeg['10'][0]).toBeLessThan(m.horizonDeg['2'][0]); // higher observer sees further down
    expect(m.horizonDeg['2'][0]).toBeGreaterThan(-0.1);
  });
});

describe('discFractionAbove', () => {
  it('is 1 when the disc is wholly above, 0 when wholly below, 0.5 when centred on the line', () => {
    expect(discFractionAbove(5, 0.25, 0)).toBe(1);
    expect(discFractionAbove(-5, 0.25, 0)).toBe(0);
    expect(discFractionAbove(0, 0.25, 0)).toBeCloseTo(0.5, 12);
    expect(discFractionAbove(0.25, 0.25, 0)).toBe(1); // lower limb exactly on the line
    expect(discFractionAbove(-0.25, 0.25, 0)).toBe(0);
  });
  it('matches the circular-segment area and is monotonic in elevation', () => {
    // centre 0.125 deg above the line, radius 0.25: d = -0.5, segment fraction = 0.6955...
    expect(discFractionAbove(0.125, 0.25, 0)).toBeCloseTo((Math.acos(-0.5) + 0.5 * Math.sqrt(0.75)) / Math.PI, 12);
    let prev = -1;
    for (let el = -0.3; el <= 0.3; el += 0.01) {
      const f = discFractionAbove(el, 0.25, 0);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
  it('depends only on the offset of the line from the centre', () => {
    expect(discFractionAbove(10.1, 0.25, 10)).toBeCloseTo(discFractionAbove(-3.9, 0.25, -4), 10);
  });
});

describe('FrameCache', () => {
  it('returns the same frame object for the same timestamp', () => {
    const c = new FrameCache();
    const t = Date.UTC(2027, 0, 1);
    const a = c.get(t);
    expect(c.get(t)).toBe(a);
    expect(c.get(t + HOUR)).not.toBe(a);
    expect(a.sun).toHaveLength(3);
    expect(Math.hypot(...a.earth)).toBeGreaterThan(350000); // Earth is about 384,000 km away
  });
});

describe('intervalsAbove, timeToNextDrop, timeToNextRise', () => {
  // frac: 0 0 .25 .75 1 .75 .25 0 | up between samples 2.5 and 5.5
  const frac = new Float32Array([0, 0, 0.25, 0.75, 1, 0.75, 0.25, 0, 1, 1]);
  const t0 = 1000000, step = 1000;
  it('interpolates crossings linearly and closes runs at the series ends', () => {
    const iv = intervalsAbove(frac, t0, step);
    expect(iv).toHaveLength(2);
    expect(iv[0].startMs).toBeCloseTo(t0 + 2.5 * step, 6);
    expect(iv[0].endMs).toBeCloseTo(t0 + 5.5 * step, 6);
    expect(iv[1].startMs).toBeCloseTo(t0 + 7.5 * step, 6);
    expect(iv[1].endMs).toBe(t0 + 9 * step); // still up at the last sample
  });
  it('starts at startMs when up at sample 0, honours the threshold, and handles empty runs', () => {
    expect(intervalsAbove(new Float32Array([1, 1, 0, 0]), 0, 10)[0].startMs).toBe(0);
    expect(intervalsAbove(new Float32Array([0, 0, 0]), 0, 10)).toEqual([]);
    const iv = intervalsAbove(frac, t0, step, 0.25);
    expect(iv[0].startMs).toBeCloseTo(t0 + 2 * step, 6); // sample 2 sits exactly at the threshold
  });
  it('timeToNextDrop: 0 if already below, interpolated, null if never', () => {
    expect(timeToNextDrop(frac, 0, step)).toBe(0);
    expect(timeToNextDrop(frac, 3, step)).toBeCloseTo(2.5 * step, 6);
    expect(timeToNextDrop(frac, 8, step)).toBeNull();
    expect(timeToNextDrop(frac, 4, step, 0.9)).toBeCloseTo(0.4 * step, 6); // 1.0 -> .75 passes .9 at 40%
  });
  it('timeToNextRise mirrors timeToNextDrop', () => {
    expect(timeToNextRise(frac, 4, step)).toBe(0);
    expect(timeToNextRise(frac, 0, step)).toBeCloseTo(2.5 * step, 6);
    expect(timeToNextRise(frac, 6, step)).toBeCloseTo(1.5 * step, 6); // .25 at 6, 0 at 7, 1 at 8: crosses .5 at 7.5
    expect(timeToNextRise(frac, 5, step)).toBe(0); // already up
    expect(timeToNextRise(new Float32Array([0, 0, 0]), 0, step)).toBeNull();
  });
});

describe('computeSeries with a hand-built skyline', () => {
  const flat = (deg: number): HorizonMask => ({
    ...smoothSphereMask('hand', 'Hand', -89.5, 0, [2]),
    horizonDeg: { '2': new Array<number>(720).fill(deg) },
  });
  const start = Date.UTC(2027, 5, 1);
  const frames = new FrameCache();

  it('fills every array, reports the skyline at the body azimuth, and uses true angular radii', () => {
    const s = computeSeries(flat(0.5), 2, start, 6 * HOUR, 40, frames);
    expect(s.n).toBe(40);
    expect(s.sunEl).toHaveLength(40);
    for (let i = 0; i < 40; i++) {
      expect(s.sunHorizon[i]).toBeCloseTo(0.5, 5);
      expect(s.earthHorizon[i]).toBeCloseTo(0.5, 5);
      expect(s.sunAz[i]).toBeGreaterThanOrEqual(0);
      expect(s.sunAz[i]).toBeLessThan(360);
      if (s.sunEl[i] > 0.5 + 0.3) expect(s.sunFrac[i]).toBe(1);
      if (s.sunEl[i] < 0.5 - 0.3) expect(s.sunFrac[i]).toBe(0);
      if (s.earthEl[i] > 0.5 + 1) expect(s.earthFrac[i]).toBe(1);
      if (s.earthEl[i] < 0.5 - 1) expect(s.earthFrac[i]).toBe(0);
    }
  });

  it('a higher skyline lowers the Sun fraction everywhere', () => {
    const lo = computeSeries(flat(-5), 2, start, 6 * HOUR, 40, frames);
    const hi = computeSeries(flat(0), 2, start, 6 * HOUR, 40, frames);
    let sumLo = 0, sumHi = 0;
    for (let i = 0; i < 40; i++) {
      expect(hi.sunFrac[i]).toBeLessThanOrEqual(lo.sunFrac[i]);
      sumLo += lo.sunFrac[i];
      sumHi += hi.sunFrac[i];
    }
    expect(sumHi).toBeLessThan(sumLo);
  });

  it('raises the observer by the ground elevation plus height', () => {
    const base = smoothSphereMask('g', 'G', 10, 20, [2]);
    const high: HorizonMask = { ...base, groundElevM: 2000 };
    // Same skyline table, different observer radius: Earth parallax differs by a hair, but az/el stay close.
    const a = computeSeries(base, 2, start, HOUR, 3, frames);
    const b = computeSeries(high, 2, start, HOUR, 3, frames);
    expect(b.earthEl[0]).not.toBe(a.earthEl[0]);
    expect(Math.abs(b.earthEl[0] - a.earthEl[0])).toBeLessThan(0.1);
  });

  it('throws a clear error when the mask has no skyline for the height', () => {
    expect(() => computeSeries(flat(0), 10, start, HOUR, 3, frames)).toThrow(/height 10/);
  });
});

describe('physical check 1: exact south pole, smooth sphere, hourly for 2027', () => {
  const mask = smoothSphereMask('pole', 'South Pole', -90, 0, [2]);
  const start = Date.UTC(2027, 0, 1);
  const n = 365 * 24;
  const s = computeSeries(mask, 2, start, HOUR, n, new FrameCache());

  it('Sun centre stays within +/-1.7 deg, Earth centre within +/-7.5 deg', () => {
    const range = (a: Float32Array) => [Math.min(...a), Math.max(...a)];
    const [sMin, sMax] = range(s.sunEl);
    const [eMin, eMax] = range(s.earthEl);
    console.log(`[check 1] Sun el ${sMin.toFixed(3)}..${sMax.toFixed(3)} deg; Earth el ${eMin.toFixed(3)}..${eMax.toFixed(3)} deg`);
    expect(sMin).toBeGreaterThan(-1.7);
    expect(sMax).toBeLessThan(1.7);
    expect(eMin).toBeGreaterThan(-7.5);
    expect(eMax).toBeLessThan(7.5);
  });

  it('Sun azimuth decreases with time at about 12.2 deg per day', () => {
    let total = 0, negative = 0;
    for (let i = 1; i < n; i++) {
      const d = ((((s.sunAz[i] - s.sunAz[i - 1]) % 360) + 540) % 360) - 180; // wrapped step in (-180, 180]
      total += d;
      if (d < 0) negative++;
    }
    const perDay = total / ((n - 1) / 24);
    console.log(`[check 1] mean Sun azimuth rate ${perDay.toFixed(3)} deg/day; ${(100 * negative / (n - 1)).toFixed(1)}% of hourly steps negative`);
    expect(perDay).toBeLessThan(-12.0);
    expect(perDay).toBeGreaterThan(-12.4);
    expect(negative / (n - 1)).toBeGreaterThan(0.95);
  });
});

describe('physical check 2: IM-1 Odysseus (-80.13, 1.44), smooth sphere, hourly from 2024-02-22', () => {
  const mask = smoothSphereMask('im1', 'IM-1 Odysseus', -80.13, 1.44, [2]);
  const start = Date.UTC(2024, 1, 22);
  const n = 35 * 24;
  const s = computeSeries(mask, 2, start, HOUR, n, new FrameCache());
  const at = (ms: number) => Math.round((ms - start) / HOUR);

  it('Sun centre is about +10.5 deg on 2024-02-23 00:00 UTC (JPL Horizons, within 0.2)', () => {
    const el = s.sunEl[at(Date.UTC(2024, 1, 23))];
    console.log(`[check 2] Sun el 2024-02-23 00:00 = ${el.toFixed(3)} deg`);
    expect(Math.abs(el - 10.5)).toBeLessThan(0.2);
  });

  it('Sun centre falls through 0 between 2024-03-03 and 2024-03-04 UTC', () => {
    let i = at(Date.UTC(2024, 1, 23));
    while (i < n && s.sunEl[i] >= 0) i++;
    const when = new Date(start + i * HOUR).toISOString();
    console.log(`[check 2] Sun centre first below 0 at ${when} (el ${s.sunEl[i].toFixed(3)})`);
    expect(start + i * HOUR).toBeGreaterThanOrEqual(Date.UTC(2024, 2, 3));
    expect(start + i * HOUR).toBeLessThanOrEqual(Date.UTC(2024, 2, 4));
  });

  it('Earth centre stays above the horizon through 2024-03-25 with a minimum of about 2.7 deg near 2024-03-06', () => {
    const last = at(Date.UTC(2024, 2, 25));
    let min = Infinity, minI = 0;
    for (let i = 0; i <= last; i++) {
      if (s.earthEl[i] < min) { min = s.earthEl[i]; minI = i; }
    }
    console.log(`[check 2] Earth el minimum ${min.toFixed(3)} deg at ${new Date(start + minI * HOUR).toISOString()}`);
    expect(min).toBeGreaterThan(0);
    expect(Math.abs(min - 2.7)).toBeLessThan(0.2);
    expect(Math.abs(start + minI * HOUR - Date.UTC(2024, 2, 6))).toBeLessThan(2 * DAY);
  });
});

describe('physical check 3: Blue Ghost Mission 1 (18.56, 61.81), smooth sphere, landing 2025-03-02 08:34 UTC', () => {
  const mask = smoothSphereMask('bg1', 'Blue Ghost M1', 18.56, 61.81, [2]);
  const landing = Date.UTC(2025, 2, 2, 8, 34);
  const step = 10 * 60000;
  const n = 20 * 144;
  const s = computeSeries(mask, 2, landing, step, n, new FrameCache());
  const lunarDay = PROFILES.find((p) => p.id === 'lunar-day')!;

  it('first sunset after landing falls on 2025-03-16 UTC', () => {
    // The 14-day profile ends before sunset, so look through a longer stay to find it.
    const e = evaluate(s, 0, { ...lunarDay, stayDays: 19 });
    const hours = e.firstSunsetAfterH!;
    const when = new Date(landing + hours * HOUR);
    console.log(`[check 3] first sunset ${hours.toFixed(1)} h after landing = ${when.toISOString()} (mission reported ~346 h of daylight operations, sunset 2025-03-16)`);
    expect(hours).not.toBeNull();
    expect(when.toISOString().slice(0, 10)).toBe('2025-03-16');
  });
});
