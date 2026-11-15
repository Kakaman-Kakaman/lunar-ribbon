// Solar power and battery state for a lander, from the Sun's position, the visible part of its
// disc (terrain and eclipses), and a simple panel and battery.
//
// Physics: irradiance on a panel = S x (a / d)^2 x visible fraction x (1 - eclipse cover) x cos(incidence),
// where S is the solar irradiance at Earth's mean distance a, and d is the Sun's distance. The disc is
// treated as uniformly bright (limb darkening is ignored), and terrain and eclipse losses multiply.
// The panel, battery and load numbers are this tool's assumptions, not any real lander's.

import type { SiteSeries } from './visibility';

/** Solar irradiance at Earth's mean distance from the Sun, W/m^2 (NASA NSSDC Earth Fact Sheet). */
export const SOLAR_IRRADIANCE_W_M2 = 1361.0;
/** Earth's mean distance from the Sun (semimajor axis), km (NASA NSSDC Earth Fact Sheet). */
export const EARTH_SUN_MEAN_KM = 149.598e6;

const DEG = Math.PI / 180;

/**
 * How the panel is mounted.
 * - `vertical-tracking`: an upright panel turned to face the Sun's azimuth (the usual polar layout).
 * - `vertical-fixed`: an upright panel facing a fixed azimuth, `faceAzDeg`.
 * - `horizontal`: a panel lying flat, facing up.
 */
export type PanelMount = 'vertical-tracking' | 'vertical-fixed' | 'horizontal';

export interface PowerConfig {
  mount: PanelMount;
  /** For `vertical-fixed`: the azimuth the panel faces, degrees clockwise from north. */
  faceAzDeg?: number;
  areaM2: number;
  /** Fraction of incident sunlight delivered to the bus (cells, wiring and conversion together), 0-1. */
  efficiency: number;
  batteryWh: number;
  /** Battery charge at the start, as a fraction of capacity. */
  startCharge: number;
  /** Constant electrical load, W. */
  loadW: number;
}

/** Defaults: round numbers chosen by this tool so the model runs; edit them for a real design. */
export const DEFAULT_POWER: PowerConfig = {
  mount: 'vertical-tracking',
  areaM2: 2,
  efficiency: 0.25,
  batteryWh: 2000,
  startCharge: 1,
  loadW: 150,
};

/** Cosine of the angle between the Sun and the panel's normal; 0 when the Sun is behind the panel. */
export function incidenceCos(cfg: Pick<PowerConfig, 'mount' | 'faceAzDeg'>, sunAzDeg: number, sunElDeg: number): number {
  const ce = Math.cos(sunElDeg * DEG);
  let c: number;
  switch (cfg.mount) {
    case 'vertical-tracking':
      c = ce;
      break;
    case 'vertical-fixed':
      c = ce * Math.cos((sunAzDeg - (cfg.faceAzDeg ?? 0)) * DEG);
      break;
    case 'horizontal':
      c = Math.sin(sunElDeg * DEG);
      break;
  }
  return c > 0 ? c : 0;
}

/** Electrical power from the panel, W. */
export function solarPowerW(
  cfg: PowerConfig,
  sunAzDeg: number,
  sunElDeg: number,
  sunDistKm: number,
  visibleFrac: number,
  eclipseCover = 0,
): number {
  const s = SOLAR_IRRADIANCE_W_M2 * (EARTH_SUN_MEAN_KM / sunDistKm) ** 2;
  const lit = Math.max(0, Math.min(1, visibleFrac)) * (1 - Math.max(0, Math.min(1, eclipseCover)));
  return s * lit * incidenceCos(cfg, sunAzDeg, sunElDeg) * cfg.areaM2 * cfg.efficiency;
}

export interface PowerRun {
  /** Index into the series of the first sample, and number of samples. */
  i0: number;
  n: number;
  /** Panel output at each sample, W. */
  powerW: Float32Array;
  /** Battery charge at each sample, Wh (before that sample's interval is applied). */
  chargeWh: Float32Array;
  /** Time the battery first runs empty, or null if it never does. */
  emptyAtMs: number | null;
  minChargeWh: number;
  energyInWh: number;
  energyUsedWh: number;
  /** Load energy that could not be supplied because the battery was empty, Wh. */
  shortfallWh: number;
  /** Panel energy that could not be stored because the battery was full, Wh. */
  spilledWh: number;
  /** Battery charge after the last step, Wh. */
  endChargeWh: number;
}

/**
 * Steps the battery through samples i0 .. i0 + n - 1 of a series. Each sample's panel output and
 * the load are held for one step; the battery is clamped between empty and full (surplus is lost).
 */
export function simulatePower(series: SiteSeries, cfg: PowerConfig, i0: number, n: number): PowerRun {
  if (!series.sunDistKm) throw new Error('series has no Sun distance; compute it with computeSeries');
  const stepH = series.stepMs / 3600000;
  const powerW = new Float32Array(n);
  const chargeWh = new Float32Array(n);
  let q = cfg.batteryWh * cfg.startCharge;
  let emptyAtMs: number | null = null;
  let minQ = q, eIn = 0, eUsed = 0, short = 0, spilled = 0;
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    const p = solarPowerW(cfg, series.sunAz[i], series.sunEl[i], series.sunDistKm[i], series.sunFrac[i], series.sunCover?.[i] ?? 0);
    powerW[k] = p;
    chargeWh[k] = q;
    if (q < minQ) minQ = q;
    eIn += p * stepH;
    const net = (p - cfg.loadW) * stepH;
    let next = q + net;
    if (next < 0) {
      if (emptyAtMs === null) emptyAtMs = series.startMs + i * series.stepMs + (q / -net) * series.stepMs;
      short += -next;
      eUsed += cfg.loadW * stepH + next;
      next = 0;
    } else {
      eUsed += cfg.loadW * stepH;
    }
    if (next > cfg.batteryWh) {
      spilled += next - cfg.batteryWh;
      next = cfg.batteryWh;
    }
    q = next;
  }
  if (q < minQ) minQ = q;
  return { i0, n, powerW, chargeWh, emptyAtMs, minChargeWh: minQ, energyInWh: eIn, energyUsedWh: eUsed, shortfallWh: short, spilledWh: spilled, endChargeWh: q };
}
