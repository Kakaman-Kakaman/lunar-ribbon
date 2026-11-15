import { describe, expect, it } from 'vitest';
import type { DsnSeries } from '../src/engine/dsn.ts';
import { EARTH_SUN_MEAN_KM, SOLAR_IRRADIANCE_W_M2 } from '../src/engine/power.ts';
import { evaluateRequirements, scanRequirements, type Requirements } from '../src/engine/requirements.ts';
import type { SiteSeries } from '../src/engine/visibility.ts';

const HOUR = 3600000;
const N = 24 * 30;
const f32 = (v: (i: number) => number) => Float32Array.from({ length: N }, (_, i) => v(i));

function series(sun: (i: number) => number, earth: (i: number) => number = () => 1): SiteSeries {
  return {
    startMs: 0, stepMs: HOUR, n: N,
    sunAz: f32(() => 90), sunEl: f32(() => 1), sunHorizon: f32(() => 0), sunFrac: f32(sun),
    earthAz: f32(() => 0), earthEl: f32(() => 5), earthHorizon: f32(() => 0), earthFrac: f32(earth),
    sunCover: f32(() => 0), sunDistKm: f32(() => EARTH_SUN_MEAN_KM),
  };
}
/** Moon elevation at the three complexes; `seen(i, k)` true puts it at 30 degrees, else at -30. */
function dsn(seen: (i: number, k: number) => boolean): DsnSeries {
  return { startMs: 0, stepMs: HOUR, n: N, moonElDeg: [0, 1, 2].map((k) => f32((i) => (seen(i, k) ? 30 : -30))) };
}
const allSeen = dsn(() => true);
const base: Requirements = { stayDays: 6.5, upThreshold: 0.5, sunAtLanding: true, earthAtLanding: true };

describe('requirements', () => {
  it('passes a stay with the Sun, Earth and a complex always up', () => {
    const r = evaluateRequirements(series(() => 1), 0, { ...base, maxDarkHours: 0, contact: { minHoursPerDay: 24, minElDeg: 6 } }, allSeen);
    expect(r.ok).toBe(true);
    expect(r.worstDayContactH).toBe(24);
    expect(r.contactShare).toBe(1);
  });

  it('fails a dark spell longer than allowed, at the hour it passes the limit', () => {
    const r = evaluateRequirements(series((i) => (i >= 30 && i < 50 ? 0 : 1)), 0, { ...base, maxDarkHours: 12 });
    expect(r.failures).toEqual(['dark-spell']);
    expect(r.firstFailureAfterH).toBe(43); // dark from hour 30; the 13th dark hour ends at 43
    expect(r.longestDarkH).toBe(20);
  });

  it('fails the battery rule when a dark spell drains it below the floor', () => {
    // Panel 1 m2 at 10%: about 136 W in sunlight against a 100 W load; 1000 Wh battery, floor 20%.
    const config = { mount: 'vertical-tracking' as const, areaM2: 1, efficiency: 0.1, batteryWh: 1000, startCharge: 1, loadW: 100 };
    const ok = evaluateRequirements(series((i) => (i >= 30 && i < 37 ? 0 : 1)), 0, { ...base, power: { config, minCharge: 0.2 } });
    expect(ok.ok).toBe(true); // 7 h dark uses 700 Wh: 30% left
    expect(ok.minChargeFrac).toBeCloseTo(0.3, 6);
    const bad = evaluateRequirements(series((i) => (i >= 30 && i < 45 ? 0 : 1)), 0, { ...base, power: { config, minCharge: 0.2 } });
    expect(bad.failures).toEqual(['battery']);
    expect(bad.firstFailureAfterH).toBe(39); // 800 Wh used after 8 dark hours (hour 38), below 200 Wh from hour 39
    expect(bad.batteryEmptyAfterH).toBe(40);
    expect(SOLAR_IRRADIANCE_W_M2 * 0.1).toBeGreaterThan(100);
  });

  it('fails the contact rule on the first day short of contact hours', () => {
    // Only the first complex sees the Moon, and only in the first 12 hours of each day from day 2 on.
    const partial = dsn((i, k) => k === 0 && (i < 24 || i % 24 < 12));
    const r = evaluateRequirements(series(() => 1), 0, { ...base, contact: { minHoursPerDay: 18, minElDeg: 6 } }, partial);
    expect(r.failures).toEqual(['contact']);
    expect(r.worstDayContactH).toBe(12);
    expect(r.firstFailureAfterH).toBe(48);
  });

  it('counts contact only when Earth is also in view from the lander', () => {
    const r = evaluateRequirements(series(() => 1, (i) => (i % 24 < 20 ? 1 : 0)), 0, { ...base, earthAtLanding: true, contact: { minHoursPerDay: 18, minElDeg: 6 } }, allSeen);
    expect(r.worstDayContactH).toBe(20);
    expect(r.ok).toBe(true);
  });

  it('scans landing times and marks the ones that work', () => {
    // Dark for 20 h starting at hour 200: stays that contain it fail a 12 h limit.
    const s = series((i) => (i >= 200 && i < 220 ? 0 : 1));
    // Landing rules off, so only the dark-spell rule decides.
    const scan = scanRequirements(s, { ...base, sunAtLanding: false, earthAtLanding: false, maxDarkHours: 12 }, 0, 300, 6);
    const failing = [...scan.ok].map((v, k) => (v ? -1 : k * 6)).filter((v) => v >= 0);
    // A 6.5-day (156 h) stay starting at L contains hours L..L+155; it fails if it contains 13 dark hours.
    expect(failing[0]).toBe(60); // 60 + 155 = 215 covers 200..212
    expect(failing.at(-1)).toBe(204); // from 210 on, at most 10 dark hours remain
  });
});
