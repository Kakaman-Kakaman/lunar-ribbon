// Derive everything one plan shows from its series, mask and the scenario.
// Pure functions: the interface holds no astronomy of its own.

import {
  EARTH_RADIUS_KM,
  SUN_RADIUS_KM,
  angularRadiusDeg,
  moonFrame,
  type Vec3,
} from '../engine/ephemeris';
import type { HorizonMask } from '../engine/horizon';
import { evaluate, nextWindow, slipMarginMs, slipScan, type Evaluation, type MissionProfile, type SlipScan } from '../engine/mission';
import {
  azimuthEnvelope,
  bodyPath,
  darkSpans,
  dayTicks,
  type DarkSpan,
  type DayTick,
  type Envelope,
  type PathPoint,
} from '../engine/ribbonGeometry';
import { describeVerdict, failureContext, type FailureContext, type PowerContact, type Verdict } from '../engine/verdict';
import { DSN_RECEIVE_MIN_EL_DEG, type DsnSeries } from '../engine/dsn';
import { DEFAULT_POWER } from '../engine/power';
import { evaluateRequirements, scanRequirements, stayCount, type Requirements } from '../engine/requirements';
import type { SiteSeries } from '../engine/visibility';
import { LEAD_DAYS, SCAN_DAYS } from './compute';
import { DAY_MS, HOUR_MS } from './scenario';

/** Series-only geometry: the Sun band and Earth region over the whole series. */
export interface SeriesGeometry {
  sunBand: Envelope;
  earthRegion: Envelope;
  fromMs: number;
  toMs: number;
  /**
   * 'never': Earth stays below the local horizontal plane for the whole series (far side of the Moon).
   * 'hidden': it rises geometrically but terrain always hides at least half of it.
   * 'yes': it is up at some time.
   */
  earthRise: 'never' | 'hidden' | 'yes';
}

export function seriesGeometry(series: SiteSeries): SeriesGeometry {
  let maxEl = -Infinity;
  let anyUp = false;
  for (let i = 0; i < series.n; i++) {
    if (series.earthEl[i] > maxEl) maxEl = series.earthEl[i];
    if (series.earthFrac[i] >= 0.5) anyUp = true;
  }
  return {
    sunBand: azimuthEnvelope(series.sunAz, series.sunEl, 0, series.n),
    earthRegion: azimuthEnvelope(series.earthAz, series.earthEl, 0, series.n),
    fromMs: series.startMs,
    toMs: series.startMs + (series.n - 1) * series.stepMs,
    earthRise: anyUp ? 'yes' : maxEl < 0 ? 'never' : 'hidden',
  };
}

/** The elevation range of the ribbon, shared by both plans. */
export interface YRange {
  min: number;
  max: number;
  /** Gridline spacing, degrees. */
  step: number;
  /** True if the default range did not fit and the range was widened to the Sun band and Earth region. */
  fitted: boolean;
}

export const DEFAULT_RANGE: YRange = { min: -8, max: 12, step: 2, fitted: false };

function extent(env: Envelope): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < env.minEl.length; i++) {
    if (env.minEl[i] < lo) lo = env.minEl[i];
    if (env.maxEl[i] > hi) hi = env.maxEl[i];
  }
  return [lo, hi];
}

/**
 * One range for both plans: -8 to +12 degrees if the Sun band and Earth region stay at or below +12
 * (sites south of about 84 S). Otherwise the top is raised to hold them with padding, up to +90 degrees.
 * The bottom stays at -8: anything lower is under the terrain and cannot be seen.
 */
export function fitRange(
  items: { geom: SeriesGeometry; sunRadiusDeg: number; earthRadiusDeg: number }[],
): YRange {
  let hi = -Infinity;
  for (const it of items) {
    hi = Math.max(hi, extent(it.geom.sunBand)[1] + it.sunRadiusDeg);
    if (it.geom.earthRise !== 'never') hi = Math.max(hi, extent(it.geom.earthRegion)[1] + it.earthRadiusDeg);
  }
  if (!Number.isFinite(hi) || hi <= DEFAULT_RANGE.max) return DEFAULT_RANGE;
  const span = hi - DEFAULT_RANGE.min;
  const step = span <= 30 ? 2 : span <= 60 ? 5 : 10;
  const max = Math.min(90, Math.ceil((hi + span * 0.05) / step) * step);
  return { min: DEFAULT_RANGE.min, max, step, fitted: true };
}

/** Index of the anchor landing in the series. */
export const anchorIndex = () => LEAD_DAYS * 24;

/** The battery and contact rules of a profile as requirements, or null if it has neither. */
export function powerContactRules(profile: MissionProfile): Requirements | null {
  if (profile.minBatteryCharge === undefined && profile.minContactHoursPerDay === undefined) return null;
  return {
    stayDays: profile.stayDays,
    upThreshold: 0.5,
    sunAtLanding: false,
    earthAtLanding: false,
    power: profile.minBatteryCharge !== undefined ? { config: DEFAULT_POWER, minCharge: profile.minBatteryCharge } : undefined,
    contact: profile.minContactHoursPerDay !== undefined ? { minHoursPerDay: profile.minContactHoursPerDay, minElDeg: DSN_RECEIVE_MIN_EL_DEG } : undefined,
  };
}

/** Bit set in a slip-scan code when the battery or contact rule fails (1 = Sun, 2 = Earth). */
export const POWER_CONTACT_BIT = 4;

/**
 * The slip scan: one candidate per 6 hours of landing time for the year after the anchor. With a
 * DSN series, candidates that break the battery or contact rule also get POWER_CONTACT_BIT.
 */
export function scanFor(series: SiteSeries, profile: MissionProfile, dsn?: DsnSeries): SlipScan {
  const from = anchorIndex();
  const scan = slipScan(series, profile, from, from + SCAN_DAYS * 24, 6);
  const rules = powerContactRules(profile);
  if (rules && dsn) {
    const ex = scanRequirements(series, rules, from, from + SCAN_DAYS * 24, 6, dsn);
    for (let k = 0; k < Math.min(scan.n, ex.ok.length); k++) if (!ex.ok[k]) scan.code[k] |= POWER_CONTACT_BIT;
  }
  return scan;
}

export interface PlanView {
  landingMs: number;
  landingIdx: number;
  profile: MissionProfile;
  ev: Evaluation;
  /** Battery and contact outcome (version 2); null when the profile has neither rule. */
  power: PowerContact | null;
  ctx: FailureContext;
  verdict: Verdict;
  scan: SlipScan;
  slipMarginMs: number;
  nextStartMs: number | null;
  stayEndIdx: number;
  pathEndIdx: number;
  sunPath: PathPoint[];
  earthPath: PathPoint[];
  ticks: DayTick[];
  spans: DarkSpan[];
  sunRadiusDeg: number;
  earthRadiusDeg: number;
  /** Median change of the Sun's azimuth per day over the first days of the stay, degrees (signed, + is clockwise). */
  sunRateDegPerDay: number | null;
}

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

/** The first stretch of the stay when Earth covers part of the Sun while the Sun is above the skyline. */
export function eclipseInStay(series: SiteSeries, landingIdx: number, stayN: number): { startMs: number; hours: number; maxCover: number } | null {
  const cover = series.sunCover;
  if (!cover) return null;
  const end = Math.min(series.n, landingIdx + stayN);
  for (let i = Math.max(0, landingIdx); i < end; i++) {
    if (cover[i] > 0.02 && series.sunFrac[i] >= 0.5) {
      let j = i, max = 0;
      while (j < end && cover[j] > 0) { max = Math.max(max, cover[j]); j++; }
      return { startMs: series.startMs + i * series.stepMs, hours: ((j - i) * series.stepMs) / 3600000, maxCover: max };
    }
  }
  return null;
}

export function planView(
  mask: HorizonMask,
  series: SiteSeries,
  heightM: number,
  landingMs: number,
  profile: MissionProfile,
  scan: SlipScan,
  dsn?: DsnSeries,
): PlanView {
  const { stepMs } = series;
  const landingIdx = Math.round((landingMs - series.startMs) / stepMs);
  const ev = evaluate(series, landingIdx, profile);
  const rules = powerContactRules(profile);
  let power: PowerContact | null = null;
  if (rules && dsn && landingIdx >= 0 && landingIdx + stayCount(rules, stepMs) <= series.n) {
    const r = evaluateRequirements(series, landingIdx, rules, dsn);
    power = { ok: r.ok, failures: r.failures, firstFailureAfterH: r.firstFailureAfterH, minChargeFrac: r.minChargeFrac, batteryEmptyAfterH: r.batteryEmptyAfterH, worstDayContactH: r.worstDayContactH };
  }
  const ctx = failureContext(series, mask, heightM, landingIdx, ev, profile);
  const margin = slipMarginMs(scan, landingMs);
  const scanEndMs = scan.startMs + (scan.n - 1) * scan.stepMs;
  const next = nextWindow(scan, landingMs);
  const eclipse = eclipseInStay(series, landingIdx, Math.round((profile.stayDays * DAY_MS) / stepMs));
  const verdict = describeVerdict({
    ev,
    profile,
    slipMarginMs: margin,
    slipToScanEnd: margin > 0 && landingMs + margin >= scanEndMs - 1,
    nextWindowStartMs: next ? next.startMs : null,
    landingMs,
    terrain: mask.terrain,
    ctx,
    eclipse,
    power,
  });

  const stayN = Math.max(1, Math.round((profile.stayDays * DAY_MS) / stepMs));
  const stayEndIdx = Math.min(series.n, landingIdx + stayN);
  const pathEndIdx = Math.min(series.n, landingIdx + Math.max(stayN, Math.round((29.5 * DAY_MS) / stepMs)));
  const sunPath = bodyPath(series, 'sun', landingIdx, pathEndIdx, 1);
  const earthPath = bodyPath(series, 'earth', landingIdx, pathEndIdx, 2);
  const ticks = dayTicks(series, 'sun', landingIdx, Math.ceil((pathEndIdx - landingIdx) / 24));
  const spans = darkSpans(series, landingIdx, pathEndIdx);

  const f = moonFrame(new Date(landingMs));
  const sunRadiusDeg = angularRadiusDeg(SUN_RADIUS_KM, norm(f.sun));
  const earthRadiusDeg = angularRadiusDeg(EARTH_RADIUS_KM, norm(f.earth));

  const deltas: number[] = [];
  for (let d = 0; d < 8; d++) {
    const i0 = landingIdx + d * 24;
    const i1 = i0 + 24;
    if (i1 >= series.n) break;
    deltas.push(wrap180(series.sunAz[i1] - series.sunAz[i0]));
  }
  deltas.sort((a, b) => a - b);
  const rate = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;

  return {
    landingMs, landingIdx, profile, ev, power, ctx, verdict, scan,
    slipMarginMs: margin,
    nextStartMs: next ? next.startMs : null,
    stayEndIdx, pathEndIdx, sunPath, earthPath, ticks, spans,
    sunRadiusDeg, earthRadiusDeg,
    sunRateDegPerDay: rate,
  };
}
