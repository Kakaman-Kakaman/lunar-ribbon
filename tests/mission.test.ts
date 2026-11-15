// Tests for mission profiles, single-landing evaluation, and the landing-date slip scan.
// Series here are hand-built (frac 1 = up, 0 = down) so every expected number can be counted by hand.

import { describe, expect, it } from 'vitest';
import {
  PROFILES,
  evaluate,
  nextWindow,
  slipMarginMs,
  slipScan,
  type MissionProfile,
  type SlipScan,
} from '../src/engine/mission';
import type { SiteSeries } from '../src/engine/visibility';

const HOUR = 3600000;
const T0 = Date.UTC(2027, 0, 1);

/** A series where sun/earth fractions come from functions of the sample index. */
function makeSeries(
  n: number,
  sun: (i: number) => number,
  earth: (i: number) => number,
  stepMs = HOUR,
): SiteSeries {
  const z = () => new Float32Array(n);
  const s: SiteSeries = {
    startMs: T0, stepMs, n,
    sunAz: z(), sunEl: z(), sunHorizon: z(), sunFrac: z(),
    earthAz: z(), earthEl: z(), earthHorizon: z(), earthFrac: z(),
  };
  for (let i = 0; i < n; i++) {
    s.sunFrac[i] = sun(i);
    s.earthFrac[i] = earth(i);
  }
  return s;
}

const byId = (id: string) => PROFILES.find((p) => p.id === id)!;
const short = byId('short-stay');
const lunarDay = byId('lunar-day');
const rover = byId('long-rover');

/** Deterministic pseudo-random runs of up (1) and down (0.1 or 0.5-ish) samples. */
function randomRuns(n: number, seed: number, up: [number, number], down: [number, number]): (i: number) => number {
  let x = seed;
  const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(n);
  let i = 0, isUp = rnd() < 0.5;
  while (i < n) {
    const [lo, hi] = isUp ? up : down;
    const len = Math.floor(lo + rnd() * (hi - lo));
    for (let k = 0; k < len && i < n; k++, i++) out[i] = isUp ? 1 : rnd() < 0.2 ? 0.49 : 0.1;
    isUp = !isUp;
  }
  return (j) => out[j];
}

describe('PROFILES', () => {
  it('holds the three presets with the specified values', () => {
    expect(PROFILES.map((p) => p.id)).toEqual(['short-stay', 'lunar-day', 'long-rover']);
    expect(short).toMatchObject({ label: 'Short stay (6.5 days)', stayDays: 6.5, maxDarkGapHours: 0, minEarthShare: 1, needSunAtLanding: true, needEarthAtLanding: true });
    expect(lunarDay).toMatchObject({ label: 'One lunar day (14 days)', stayDays: 14, maxDarkGapHours: 0, minEarthShare: 0.75, needSunAtLanding: true, needEarthAtLanding: true });
    expect(rover).toMatchObject({ label: 'Long rover mission (100 days)', stayDays: 100, maxDarkGapHours: 96, minEarthShare: 0.5, needSunAtLanding: true, needEarthAtLanding: true });
    // Version 2: battery floor and contact hours per day; every basis names which numbers are NASA's and which are this tool's.
    expect(short).toMatchObject({ minBatteryCharge: 0.2, minContactHoursPerDay: 24 });
    expect(lunarDay).toMatchObject({ minBatteryCharge: 0.2, minContactHoursPerDay: 18 });
    expect(rover.minBatteryCharge).toBeUndefined();
    expect(rover.minContactHoursPerDay).toBe(12);
    expect(short.basis).toMatch(/^NASA's Artemis III planning: a 6\.5-day surface stay with continuous sunlight and direct-to-Earth communication, no relay\./);
    expect(lunarDay.basis).toMatch(/this tool's defaults, not NASA figures/);
    expect(rover.basis).toMatch(/^NASA's VIPER plan: 100 days/);
    for (const p of [short, lunarDay, rover]) expect(p.basis).toMatch(/this tool's/);
  });
});

describe('evaluate', () => {
  it('passes when both bodies stay up the whole stay', () => {
    const e = evaluate(makeSeries(400, () => 1, () => 1), 10, short);
    expect(e.ok).toBe(true);
    expect(e.failures).toEqual([]);
    expect([e.sunShare, e.earthShare, e.bothShare]).toEqual([1, 1, 1]);
    expect(e.longestDarkGapH).toBe(0);
    expect(e.longestEarthGapH).toBe(0);
    expect(e.firstSunsetAfterH).toBeNull();
    expect(e.firstEarthsetAfterH).toBeNull();
    expect(e.firstFailureAfterH).toBeNull();
  });

  it('fails at landing when the Sun or Earth is down then', () => {
    // Sun down for the first 5 hours, Earth down for the first hour.
    const s = makeSeries(400, (i) => (i < 5 ? 0 : 1), (i) => (i < 1 ? 0 : 1));
    const e = evaluate(s, 0, short);
    expect(e.ok).toBe(false);
    expect(e.failures).toEqual(['sun-down-at-landing', 'earth-down-at-landing', 'dark-gap', 'earth-share']);
    expect(e.firstFailureAfterH).toBe(0);
    expect(e.firstSunsetAfterH).toBe(0);
    expect(e.longestDarkGapH).toBe(5);
    expect(e.sunShare).toBeCloseTo(151 / 156, 12);
  });

  it('flags a dark gap in the middle of a short stay, with sunset and failure times', () => {
    const s = makeSeries(400, (i) => (i >= 50 && i < 53 ? 0 : 1), () => 1);
    const e = evaluate(s, 0, short);
    expect(e.failures).toEqual(['dark-gap']);
    expect(e.longestDarkGapH).toBe(3);
    expect(e.firstSunsetAfterH).toBeCloseTo(49.5, 9); // frac goes 1 -> 0 between samples 49 and 50
    expect(e.firstFailureAfterH).toBe(50);
    expect(e.sunShare).toBeCloseTo(153 / 156, 12);
    expect(e.bothShare).toBeCloseTo(153 / 156, 12);
  });

  it('counts stay samples from the landing index and ignores dark time outside the stay', () => {
    const s = makeSeries(400, (i) => (i >= 200 && i < 260 ? 0 : 1), () => 1);
    expect(evaluate(s, 0, short).ok).toBe(true); // stay is samples 0..155
    expect(evaluate(s, 100, short).ok).toBe(false); // stay is samples 100..255
    expect(evaluate(s, 261, short).ok).toBe(true);
  });

  it('rover profile tolerates a dark gap of exactly 96 h but not 97 h', () => {
    const gap = (len: number) => makeSeries(2600, (i) => (i >= 500 && i < 500 + len ? 0 : 1), () => 1);
    expect(evaluate(gap(96), 0, rover).ok).toBe(true);
    const e = evaluate(gap(97), 0, rover);
    expect(e.failures).toEqual(['dark-gap']);
    expect(e.longestDarkGapH).toBe(97);
    expect(e.firstFailureAfterH).toBe(500 + 96); // the moment the gap passes four days
  });

  it('earth-share: exactly the required share passes, one sample less fails at the moment the budget runs out', () => {
    // Lunar day: 336 samples, 75% => 84 Earth-down samples allowed.
    const down = (len: number) => makeSeries(700, () => 1, (i) => (i >= 100 && i < 100 + len ? 0 : 1));
    const ok = evaluate(down(84), 0, lunarDay);
    expect(ok.ok).toBe(true);
    expect(ok.earthShare).toBeCloseTo(0.75, 12);
    expect(ok.longestEarthGapH).toBe(84);
    const bad = evaluate(down(85), 0, lunarDay);
    expect(bad.failures).toEqual(['earth-share']);
    expect(bad.firstEarthsetAfterH).toBeCloseTo(99.5, 9);
    expect(bad.firstFailureAfterH).toBeCloseTo(184, 9); // sample 100 + 84 h of allowed Earth-down time
  });

  it('firstFailureAfterH is the earliest of the broken requirements', () => {
    // Earth budget runs out at 150 h, Sun gap breaks at 40 h.
    const s = makeSeries(
      700,
      (i) => (i === 40 ? 0 : 1),
      (i) => (i >= 150 && i < 240 ? 0 : 1),
    );
    const e = evaluate(s, 0, lunarDay);
    expect(e.failures).toEqual(['dark-gap', 'earth-share']);
    expect(e.firstFailureAfterH).toBe(40);
  });

  it('bothShare is the share of the stay with Sun and Earth up at once', () => {
    // Sun up in even 12 h blocks, Earth up in the first 18 h of each 24 h: overlap is 12 of 24 only where aligned.
    const s = makeSeries(100, (i) => (Math.floor(i / 12) % 2 === 0 ? 1 : 0), (i) => (i % 24 < 18 ? 1 : 0));
    const e = evaluate(s, 0, { ...short, stayDays: 2, needSunAtLanding: false, needEarthAtLanding: false });
    expect(e.sunShare).toBe(0.5);
    expect(e.earthShare).toBe(0.75);
    expect(e.bothShare).toBe(0.5); // Sun-up blocks 0-12 and 24-36 lie wholly inside Earth-up time
  });

  it('evaluates only the part of the stay that exists when the series ends early', () => {
    const s = makeSeries(40, () => 1, (i) => (i < 30 ? 1 : 0));
    const e = evaluate(s, 20, short); // samples 20..39
    expect(e.earthShare).toBe(0.5);
    expect(e.sunShare).toBe(1);
    expect(e.longestEarthGapH).toBe(10);
    expect(e.firstSunsetAfterH).toBeNull();
  });

  it('works with a non-hourly step', () => {
    const step = 6 * HOUR;
    const s = makeSeries(100, (i) => (i === 10 ? 0 : 1), () => 1, step);
    const e = evaluate(s, 0, short); // 6.5 days = 26 samples
    expect(e.longestDarkGapH).toBe(6);
    expect(e.sunShare).toBeCloseTo(25 / 26, 12);
    expect(e.firstFailureAfterH).toBe(60);
  });

  it('honours a custom threshold', () => {
    const s = makeSeries(400, () => 0.6, () => 0.6);
    expect(evaluate(s, 0, short).ok).toBe(true);
    expect(evaluate(s, 0, short, 0.7).failures).toContain('sun-down-at-landing');
  });
});

describe('slipScan', () => {
  it('lists only candidates whose whole stay fits, and describes its own time axis', () => {
    const s = makeSeries(400, () => 1, () => 1); // short stay = 156 samples, last candidate 244
    const scan = slipScan(s, short, 0, 400, 1);
    expect(scan.n).toBe(245);
    expect(scan.code).toHaveLength(245);
    expect(scan.startMs).toBe(T0);
    expect(scan.stepMs).toBe(HOUR);
    expect(scan.code.every((c) => c === 0)).toBe(true);

    const strided = slipScan(s, short, 10, 200, 6);
    expect(strided.startMs).toBe(T0 + 10 * HOUR);
    expect(strided.stepMs).toBe(6 * HOUR);
    expect(strided.n).toBe(Math.ceil(190 / 6)); // candidates 10, 16, ..., 196
    expect(slipScan(s, short, 300, 400, 1).n).toBe(0);
  });

  it('codes: 1 Sun fails, 2 Earth fails, 3 both', () => {
    // Sun down at hour 100, Earth down at hour 300; short-stay candidates cover 156 samples.
    const s = makeSeries(500, (i) => (i === 100 ? 0 : 1), (i) => (i === 300 ? 0 : 1));
    const scan = slipScan(s, short, 0, 500, 1);
    expect(scan.code[0]).toBe(1); // stay 0..155 contains the dark sample 100
    expect(scan.code[100]).toBe(1); // Sun down at landing
    expect(scan.code[50]).toBe(1); // dark sample inside the stay (50..205)
    expect(scan.code[101]).toBe(0);
    expect(scan.code[145]).toBe(2); // stay 145..300: Earth sample 300 is the last one in
    expect(scan.code[144]).toBe(0); // stay 144..299: just clear
    // Make one candidate fail both.
    const s2 = makeSeries(500, (i) => (i === 100 ? 0 : 1), (i) => (i === 120 ? 0 : 1));
    expect(slipScan(s2, short, 0, 500, 1).code[0]).toBe(3);
  });

  it('agrees with evaluate on a sample of candidates, for every profile', () => {
    const n = 17520;
    const s = makeSeries(n, randomRuns(n, 7, [60, 420], [10, 160]), randomRuns(n, 99, [30, 300], [5, 120]));
    for (const p of PROFILES) {
      const scan = slipScan(s, p, 0, n, 6);
      let nonZero = 0;
      for (let k = 0; k < scan.n; k++) if (scan.code[k] !== 0) nonZero++;
      for (let k = 0; k < scan.n; k += 7) {
        const e = evaluate(s, k * 6, p);
        const expected =
          (e.failures.some((f) => f === 'sun-down-at-landing' || f === 'dark-gap') ? 1 : 0) |
          (e.failures.some((f) => f === 'earth-down-at-landing' || f === 'earth-share') ? 2 : 0);
        expect(scan.code[k], `${p.id} candidate ${k}`).toBe(expected);
      }
      expect(nonZero, `${p.id} has failing candidates`).toBeGreaterThan(0);
    }
    // The short and lunar-day profiles should also have some ok candidates in this series.
    const okShort = slipScan(s, short, 0, n, 6).code.filter((c) => c === 0).length;
    expect(okShort).toBeGreaterThan(0);
  });

  it('agrees with evaluate for every candidate on a small series with a stride of 1 and a non-hourly step', () => {
    const step = 2 * HOUR;
    const n = 300;
    const s = makeSeries(n, randomRuns(n, 3, [5, 40], [1, 12]), randomRuns(n, 11, [3, 25], [1, 9]), step);
    for (const p of PROFILES) {
      const scan = slipScan(s, p, 0, n, 1);
      for (let k = 0; k < scan.n; k++) {
        const e = evaluate(s, k, p);
        const expected =
          (e.failures.some((f) => f === 'sun-down-at-landing' || f === 'dark-gap') ? 1 : 0) |
          (e.failures.some((f) => f === 'earth-down-at-landing' || f === 'earth-share') ? 2 : 0);
        expect(scan.code[k], `${p.id} candidate ${k}`).toBe(expected);
      }
    }
  });

  it('scans a two-year hourly series, 6-hour stride, 100-day stay, in well under 100 ms', () => {
    const n = 2 * 365 * 24;
    const s = makeSeries(n, randomRuns(n, 5, [200, 400], [20, 100]), randomRuns(n, 8, [100, 300], [10, 90]));
    slipScan(s, rover, 0, n, 6); // warm up the JIT, as the app would have
    const t = performance.now();
    const scan = slipScan(s, rover, 0, n, 6);
    const ms = performance.now() - t;
    console.log(`[check 4] slipScan two-year hourly, stride 6, 100-day stay: ${ms.toFixed(2)} ms for ${scan.n} candidates`);
    expect(scan.n).toBe(Math.ceil((n - 2400 + 1) / 6));
    expect(ms).toBeLessThan(100);
    const cold = makeSeries(n, randomRuns(n, 5, [200, 400], [20, 100]), randomRuns(n, 8, [100, 300], [10, 90]));
    const t1 = performance.now();
    slipScan(cold, rover, 0, n, 6);
    console.log(`[check 4] first call on a fresh series: ${(performance.now() - t1).toFixed(2)} ms`);
  });
});

describe('slipMarginMs and nextWindow', () => {
  // 12 candidates, 6 h apart: ok ok ok fail ok ok fail fail ok ok ok ok
  const codes = [0, 0, 0, 1, 0, 0, 2, 3, 0, 0, 0, 0];
  const scan: SlipScan = { startMs: T0, stepMs: 6 * HOUR, n: codes.length, code: Uint8Array.from(codes) };
  const at = (k: number) => T0 + k * 6 * HOUR;

  it('slipMarginMs measures to the last ok candidate of the run that includes the landing', () => {
    expect(slipMarginMs(scan, at(0))).toBe(2 * 6 * HOUR);
    expect(slipMarginMs(scan, at(1))).toBe(1 * 6 * HOUR);
    expect(slipMarginMs(scan, at(2))).toBe(0);
    expect(slipMarginMs(scan, at(4))).toBe(6 * HOUR);
    expect(slipMarginMs(scan, at(8))).toBe(3 * 6 * HOUR); // runs to the end of the scan
  });
  it('slipMarginMs is 0 when the landing fails or lies outside the scan', () => {
    expect(slipMarginMs(scan, at(3))).toBe(0);
    expect(slipMarginMs(scan, at(7))).toBe(0);
    expect(slipMarginMs(scan, at(-1))).toBe(0);
    expect(slipMarginMs(scan, at(40))).toBe(0);
  });
  it('slipMarginMs rounds a landing time to the nearest candidate', () => {
    expect(slipMarginMs(scan, at(0) + HOUR)).toBe(2 * 6 * HOUR);
    expect(slipMarginMs(scan, at(3) + 2 * HOUR)).toBe(0);
  });

  it('nextWindow returns the next run of ok candidates at or after the given time', () => {
    expect(nextWindow(scan, at(0))).toEqual({ startMs: at(0), endMs: at(2) });
    expect(nextWindow(scan, at(1))).toEqual({ startMs: at(1), endMs: at(2) });
    expect(nextWindow(scan, at(3))).toEqual({ startMs: at(4), endMs: at(5) });
    expect(nextWindow(scan, at(5) + 1)).toEqual({ startMs: at(8), endMs: at(11) });
    expect(nextWindow(scan, at(-5))).toEqual({ startMs: at(0), endMs: at(2) });
  });
  it('nextWindow returns null when no ok candidate remains', () => {
    expect(nextWindow(scan, at(12))).toBeNull();
    const none: SlipScan = { ...scan, code: Uint8Array.from(codes.map(() => 1)) };
    expect(nextWindow(none, T0)).toBeNull();
  });
});

describe('types', () => {
  it('MissionProfile can be built by hand', () => {
    const p: MissionProfile = { ...short, id: 'custom', stayDays: 1, minEarthShare: 0.5 };
    const e = evaluate(makeSeries(100, () => 1, (i) => (i < 12 ? 0 : 1)), 0, { ...p, needEarthAtLanding: false });
    expect(e.earthShare).toBe(0.5);
    expect(e.ok).toBe(true);
  });
});
