import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POWER,
  EARTH_SUN_MEAN_KM,
  SOLAR_IRRADIANCE_W_M2,
  incidenceCos,
  simulatePower,
  solarPowerW,
  type PowerConfig,
} from '../src/engine/power.ts';
import type { SiteSeries } from '../src/engine/visibility.ts';

const HOUR = 3600000;

/** A synthetic series: Sun at a fixed azimuth and elevation, visible fraction from `frac(i)`. */
function series(n: number, frac: (i: number) => number, el = 1, distKm = EARTH_SUN_MEAN_KM): SiteSeries {
  const f = (v: (i: number) => number) => Float32Array.from({ length: n }, (_, i) => v(i));
  return {
    startMs: 0, stepMs: HOUR, n,
    sunAz: f(() => 90), sunEl: f(() => el), sunHorizon: f(() => 0), sunFrac: f(frac),
    earthAz: f(() => 0), earthEl: f(() => 5), earthHorizon: f(() => 0), earthFrac: f(() => 1),
    sunCover: f(() => 0), sunDistKm: f(() => distKm),
  };
}

describe('panel geometry', () => {
  it('gives cos(elevation) for a tracking vertical panel and sin(elevation) for a flat one', () => {
    expect(incidenceCos({ mount: 'vertical-tracking' }, 123, 2)).toBeCloseTo(Math.cos((2 * Math.PI) / 180), 12);
    expect(incidenceCos({ mount: 'horizontal' }, 123, 30)).toBeCloseTo(0.5, 12);
    expect(incidenceCos({ mount: 'horizontal' }, 123, -1)).toBe(0);
  });
  it('gives zero for a fixed panel with the Sun behind it', () => {
    expect(incidenceCos({ mount: 'vertical-fixed', faceAzDeg: 0 }, 180, 1)).toBe(0);
    expect(incidenceCos({ mount: 'vertical-fixed', faceAzDeg: 0 }, 60, 0)).toBeCloseTo(0.5, 12);
  });
});

describe('solar power', () => {
  const cfg: PowerConfig = { ...DEFAULT_POWER, mount: 'vertical-tracking', areaM2: 1, efficiency: 1 };
  it('equals the irradiance on a 1 m2 perfect panel facing the full Sun at the mean distance', () => {
    expect(solarPowerW(cfg, 0, 0, EARTH_SUN_MEAN_KM, 1)).toBeCloseTo(SOLAR_IRRADIANCE_W_M2, 6);
  });
  it('scales with the inverse square of distance, the visible fraction and the eclipse cover', () => {
    expect(solarPowerW(cfg, 0, 0, EARTH_SUN_MEAN_KM * 1.01, 1)).toBeCloseTo(SOLAR_IRRADIANCE_W_M2 / 1.0201, 6);
    expect(solarPowerW(cfg, 0, 0, EARTH_SUN_MEAN_KM, 0.25)).toBeCloseTo(SOLAR_IRRADIANCE_W_M2 / 4, 6);
    expect(solarPowerW(cfg, 0, 0, EARTH_SUN_MEAN_KM, 1, 0.5)).toBeCloseTo(SOLAR_IRRADIANCE_W_M2 / 2, 6);
    expect(solarPowerW(cfg, 0, 0, EARTH_SUN_MEAN_KM, 0)).toBe(0);
  });
});

describe('battery', () => {
  const cfg: PowerConfig = { mount: 'vertical-tracking', areaM2: 1, efficiency: 0.1, batteryWh: 1000, startCharge: 1, loadW: 100 };
  const pIn = SOLAR_IRRADIANCE_W_M2 * 0.1 * Math.cos(Math.PI / 180); // about 136 W at 1 degree

  it('stays full in steady sunlight that exceeds the load', () => {
    const r = simulatePower(series(48, () => 1), cfg, 0, 48);
    expect(r.emptyAtMs).toBeNull();
    expect(r.minChargeWh).toBeCloseTo(1000, 6);
    expect(r.energyInWh).toBeCloseTo(48 * pIn, 3);
    expect(r.shortfallWh).toBe(0);
  });

  it('runs empty in darkness exactly when the stored energy is used up', () => {
    const r = simulatePower(series(24, () => 0), cfg, 0, 24);
    expect(r.emptyAtMs).toBe(10 * HOUR); // 1000 Wh / 100 W
    expect(r.minChargeWh).toBe(0);
    expect(r.shortfallWh).toBeCloseTo(14 * 100, 6);
    expect(r.energyUsedWh).toBeCloseTo(1000, 6);
  });

  it('balances energy: start + in - used - spilled = end', () => {
    // Each day 2 h dark (-200 Wh) then 22 h lit (+36 W net, about +790 Wh): the battery fills and spills.
    const s = series(96, (i) => (i % 24 < 2 ? 0 : 1));
    const r = simulatePower(s, { ...cfg, startCharge: 0.5 }, 0, 96);
    expect(500 + r.energyInWh - r.energyUsedWh - r.spilledWh).toBeCloseTo(r.endChargeWh, 6);
    expect(r.spilledWh).toBeGreaterThan(0);
    expect(r.emptyAtMs).toBeNull();
  });
});
