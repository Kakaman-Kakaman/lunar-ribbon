// Mission requirements built on the power and contact models (docs/PLAN-V2.md E6).
//
// A landing works when, over the stay: the Sun and Earth are up at landing if required; no dark
// spell is longer than allowed; the battery never falls below a minimum charge; and every Earth
// day of the stay has at least a minimum number of hours of Deep Space Network contact. Each rule
// is optional, so the version 1 profiles are special cases. Every number in a preset says whether
// it comes from NASA or is this tool's assumption.

import { DSN_RECEIVE_MIN_EL_DEG, complexesInView, type DsnSeries } from './dsn';
import { DEFAULT_POWER, simulatePower, type PowerConfig } from './power';
import type { SiteSeries } from './visibility';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const EPS = 1e-9;

export interface Requirements {
  stayDays: number;
  /** A body counts as up when at least this fraction of its disc clears the skyline. */
  upThreshold: number;
  sunAtLanding: boolean;
  earthAtLanding: boolean;
  /** Longest allowed spell with the Sun down, hours; omit for no limit. */
  maxDarkHours?: number;
  /** Battery must stay at or above this fraction of capacity; omit to ignore power. */
  power?: { config: PowerConfig; minCharge: number };
  /** Every whole Earth day of the stay needs this many hours of DSN contact; omit to ignore contact. */
  contact?: { minHoursPerDay: number; minElDeg: number };
}

export type RequirementFailure = 'sun-at-landing' | 'earth-at-landing' | 'dark-spell' | 'battery' | 'contact';

export interface RequirementResult {
  ok: boolean;
  failures: RequirementFailure[];
  /** Hours after landing at which the first rule is broken; null if none is. */
  firstFailureAfterH: number | null;
  longestDarkH: number;
  minChargeFrac: number | null;
  batteryEmptyAfterH: number | null;
  /** Contact hours in the worst whole Earth day of the stay, and the share of the stay with contact. */
  worstDayContactH: number | null;
  contactShare: number | null;
}

export function stayCount(r: Requirements, stepMs: number): number {
  return Math.max(1, Math.round((r.stayDays * DAY_MS) / stepMs));
}

/**
 * Checks one landing time. `dsn` must share the series' start and step and is needed only when the
 * requirements include contact. The stay must fit in the series.
 */
export function evaluateRequirements(series: SiteSeries, landingIndex: number, r: Requirements, dsn?: DsnSeries): RequirementResult {
  const { stepMs, sunFrac, earthFrac } = series;
  const stepH = stepMs / HOUR_MS;
  const L = landingIndex;
  const cnt = stayCount(r, stepMs);
  if (L < 0 || L + cnt > series.n) throw new Error('the stay does not fit in the series');
  const failures: RequirementFailure[] = [];
  const times: number[] = [];

  if (r.sunAtLanding && !(sunFrac[L] >= r.upThreshold)) { failures.push('sun-at-landing'); times.push(0); }
  if (r.earthAtLanding && !(earthFrac[L] >= r.upThreshold)) { failures.push('earth-at-landing'); times.push(0); }

  // Dark spells: the first moment a spell passes the limit.
  let run = 0, longest = 0, darkBreak: number | null = null;
  for (let i = L; i < L + cnt; i++) {
    run = sunFrac[i] >= r.upThreshold ? 0 : run + 1;
    if (run > longest) longest = run;
    if (r.maxDarkHours !== undefined && darkBreak === null && run * stepH > r.maxDarkHours + EPS) darkBreak = (i - L + 1) * stepH;
  }
  if (darkBreak !== null) { failures.push('dark-spell'); times.push(darkBreak); }

  let minChargeFrac: number | null = null, batteryEmptyAfterH: number | null = null;
  if (r.power) {
    const run2 = simulatePower(series, r.power.config, L, cnt);
    minChargeFrac = run2.minChargeWh / r.power.config.batteryWh;
    const startMs = series.startMs + L * stepMs;
    if (run2.emptyAtMs !== null) batteryEmptyAfterH = (run2.emptyAtMs - startMs) / HOUR_MS;
    if (minChargeFrac < r.power.minCharge - EPS) {
      failures.push('battery');
      const floor = r.power.minCharge * r.power.config.batteryWh;
      let k = 0;
      while (k < cnt && run2.chargeWh[k] >= floor - EPS) k++;
      times.push(k < cnt ? k * stepH : cnt * stepH);
    }
  }

  let worstDayContactH: number | null = null, contactShare: number | null = null;
  if (r.contact) {
    if (!dsn || dsn.startMs !== series.startMs || dsn.stepMs !== stepMs) throw new Error('contact needs a DSN series with the same start and step');
    const perDay = Math.round(DAY_MS / stepMs);
    let total = 0, worst = Infinity;
    for (let d = 0; d + perDay <= cnt; d += perDay) {
      let c = 0;
      for (let i = L + d; i < L + d + perDay; i++) if (earthFrac[i] >= r.upThreshold && complexesInView(dsn, i, r.contact.minElDeg) !== 0) c++;
      total += c;
      if (c < worst) worst = c;
    }
    for (let i = L + Math.floor(cnt / perDay) * perDay; i < L + cnt; i++) if (earthFrac[i] >= r.upThreshold && complexesInView(dsn, i, r.contact.minElDeg) !== 0) total++;
    worstDayContactH = worst === Infinity ? null : worst * stepH;
    contactShare = total / cnt;
    if (worstDayContactH !== null && worstDayContactH < r.contact.minHoursPerDay - EPS) {
      failures.push('contact');
      // The first whole day that falls short.
      for (let d = 0; d + perDay <= cnt; d += perDay) {
        let c = 0;
        for (let i = L + d; i < L + d + perDay; i++) if (earthFrac[i] >= r.upThreshold && complexesInView(dsn, i, r.contact.minElDeg) !== 0) c++;
        if (c * stepH < r.contact.minHoursPerDay - EPS) { times.push((d + perDay) * stepH); break; }
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    firstFailureAfterH: times.length ? Math.min(...times) : null,
    longestDarkH: longest * stepH,
    minChargeFrac,
    batteryEmptyAfterH,
    worstDayContactH,
    contactShare,
  };
}

/** Every candidate landing index from `from` (inclusive) to `to` (exclusive), every `stride` samples: 1 = works, 0 = fails. */
export function scanRequirements(series: SiteSeries, r: Requirements, from: number, to: number, stride: number, dsn?: DsnSeries): { startMs: number; stepMs: number; ok: Uint8Array } {
  const cnt = stayCount(r, series.stepMs);
  const last = Math.min(to, series.n - cnt + 1);
  const total = Math.max(0, Math.ceil((last - from) / stride));
  const ok = new Uint8Array(total);
  for (let k = 0; k < total; k++) ok[k] = evaluateRequirements(series, from + k * stride, r, dsn).ok ? 1 : 0;
  return { startMs: series.startMs + from * series.stepMs, stepMs: stride * series.stepMs, ok };
}

/** Preset requirements. `basis` says which numbers are NASA's and which are this tool's. */
export const REQUIREMENT_PRESETS: { id: string; label: string; basis: string; req: Requirements }[] = [
  {
    id: 'short-stay',
    label: 'Short stay (6.5 days)',
    basis: "NASA's Artemis III planning: a 6.5-day stay with continuous sunlight. Contact every hour of every day is this tool's reading of direct-to-Earth communication; the panel, battery and load are this tool's assumptions.",
    req: { stayDays: 6.5, upThreshold: 0.5, sunAtLanding: true, earthAtLanding: true, maxDarkHours: 0, power: { config: DEFAULT_POWER, minCharge: 0.2 }, contact: { minHoursPerDay: 24, minElDeg: DSN_RECEIVE_MIN_EL_DEG } },
  },
  {
    id: 'lunar-day',
    label: 'One lunar day (14 days)',
    basis: 'Solar-powered landers such as Blue Ghost Mission 1 operate for about 14 days of daylight. The 18 hours of contact a day, the battery floor and the power numbers are this tool\'s assumptions.',
    req: { stayDays: 14, upThreshold: 0.5, sunAtLanding: true, earthAtLanding: true, power: { config: DEFAULT_POWER, minCharge: 0.2 }, contact: { minHoursPerDay: 18, minElDeg: DSN_RECEIVE_MIN_EL_DEG } },
  },
  {
    id: 'long-rover',
    label: 'Long rover mission (100 days)',
    basis: "NASA's VIPER plan: 100 days, at risk after more than four days of cold and dark (96 hours). No battery rule: surviving the dark on a reduced load is outside this simple model. The 12 hours of contact a day is this tool's assumption.",
    req: { stayDays: 100, upThreshold: 0.5, sunAtLanding: true, earthAtLanding: true, maxDarkHours: 96, contact: { minHoursPerDay: 12, minElDeg: DSN_RECEIVE_MIN_EL_DEG } },
  },
];
