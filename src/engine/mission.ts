// Does a landing date work for a given kind of mission, and how far can it slip?
//
// A MissionProfile says how long the lander stays and what it needs: how long it may go
// without the Sun, and what share of the stay it needs a direct view of Earth. evaluate
// checks one landing time against a profile; slipScan checks every candidate landing time
// in a range at once, using prefix sums so that a two-year scan takes milliseconds.
//
// Every sample stands for one step of time, so shares and gaps are counted in whole samples.
// A body is "up" when at least half its disc clears the skyline (see visibility.ts).

import type { Interval, SiteSeries } from './visibility';
import { timeToNextDrop } from './visibility';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
/** Tolerance for comparing shares and gap lengths that are exact fractions of a sample count. */
const EPS = 1e-9;

export interface MissionProfile {
  id: string;
  label: string;
  stayDays: number;
  /** Longest allowed run without the Sun during the stay (0 = Sun must stay up). */
  maxDarkGapHours: number;
  /** Required share of the stay with Earth up, 0..1. */
  minEarthShare: number;
  needSunAtLanding: boolean;
  needEarthAtLanding: boolean;
  /** Version 2: the battery must stay at or above this share of capacity (power.ts defaults); omit to ignore power. */
  minBatteryCharge?: number;
  /** Version 2: hours of Deep Space Network contact needed in every Earth day of the stay; omit to ignore contact. */
  minContactHoursPerDay?: number;
  /** One sentence: where the numbers come from. */
  basis: string;
}

export const PROFILES: MissionProfile[] = [
  {
    id: 'short-stay',
    label: 'Short stay (6.5 days)',
    stayDays: 6.5,
    maxDarkGapHours: 0,
    minEarthShare: 1,
    needSunAtLanding: true,
    needEarthAtLanding: true,
    minBatteryCharge: 0.2,
    minContactHoursPerDay: 24,
    basis: "NASA's Artemis III planning: a 6.5-day surface stay with continuous sunlight and direct-to-Earth communication, no relay. Contact every hour through the Deep Space Network, the 20% battery floor and the panel and battery sizes are this tool's assumptions.",
  },
  {
    id: 'lunar-day',
    label: 'One lunar day (14 days)',
    stayDays: 14,
    maxDarkGapHours: 0,
    minEarthShare: 0.75,
    needSunAtLanding: true,
    needEarthAtLanding: true,
    minBatteryCharge: 0.2,
    minContactHoursPerDay: 18,
    basis: "Solar-powered landers such as Blue Ghost Mission 1 operate for about 14 days of daylight. The 75% Earth-link share, 18 hours of contact a day, the 20% battery floor and the panel and battery sizes are this tool's defaults, not NASA figures.",
  },
  {
    id: 'long-rover',
    label: 'Long rover mission (100 days)',
    stayDays: 100,
    maxDarkGapHours: 96,
    minEarthShare: 0.5,
    needSunAtLanding: true,
    needEarthAtLanding: true,
    minContactHoursPerDay: 12,
    basis: "NASA's VIPER plan: 100 days, direct-to-Earth link, mission at risk after more than four days of cold and dark. The 50% Earth-link share and 12 hours of contact a day are this tool's defaults, not NASA figures; surviving the dark on a reduced load is outside this simple power model, so there is no battery rule.",
  },
];

export type Failure = 'sun-down-at-landing' | 'earth-down-at-landing' | 'dark-gap' | 'earth-share';

export interface Evaluation {
  ok: boolean;
  failures: Failure[];
  /** Shares of the stay. */
  sunShare: number;
  earthShare: number;
  bothShare: number;
  longestDarkGapH: number;
  longestEarthGapH: number;
  /** Hours after landing; null if the body stays up for the whole stay. */
  firstSunsetAfterH: number | null;
  firstEarthsetAfterH: number | null;
  /** Hours after landing at which the first requirement is broken; 0 for an at-landing failure. */
  firstFailureAfterH: number | null;
}

/** Samples in the stay (at least one). */
function stayCount(profile: MissionProfile, stepMs: number): number {
  return Math.max(1, Math.round((profile.stayDays * DAY_MS) / stepMs));
}

/** Shortest dark run, in samples, that breaks the profile's dark-gap limit. */
function breakRun(profile: MissionProfile, stepMs: number): number {
  return Math.floor((profile.maxDarkGapHours * HOUR_MS) / stepMs + EPS) + 1;
}

/**
 * Check one landing time against a profile. If the stay runs past the end of the series
 * only the part that exists is evaluated; the caller must supply enough samples.
 */
export function evaluate(
  series: SiteSeries,
  landingIndex: number,
  profile: MissionProfile,
  threshold = 0.5,
): Evaluation {
  const { stepMs, sunFrac, earthFrac } = series;
  const stepH = stepMs / HOUR_MS;
  const L = landingIndex;
  const end = Math.min(series.n, L + stayCount(profile, stepMs));
  const cnt = Math.max(0, end - L);
  const m = breakRun(profile, stepMs);

  let sunUp = 0, earthUp = 0, bothUp = 0;
  let sunRun = 0, earthRun = 0, longestSun = 0, longestEarth = 0;
  let firstDarkBreak: number | null = null; // sample index where the dark gap first exceeds its limit
  for (let i = L; i < end; i++) {
    const s = sunFrac[i] >= threshold;
    const e = earthFrac[i] >= threshold;
    if (s) sunUp++;
    if (e) earthUp++;
    if (s && e) bothUp++;
    sunRun = s ? 0 : sunRun + 1;
    earthRun = e ? 0 : earthRun + 1;
    if (sunRun > longestSun) longestSun = sunRun;
    if (earthRun > longestEarth) longestEarth = earthRun;
    if (sunRun === m && firstDarkBreak === null) firstDarkBreak = i - m + 1;
  }

  const share = (k: number) => (cnt > 0 ? k / cnt : 0);
  const sunShare = share(sunUp), earthShare = share(earthUp), bothShare = share(bothUp);

  const failures: Failure[] = [];
  const times: number[] = [];
  if (profile.needSunAtLanding && !(sunFrac[L] >= threshold)) {
    failures.push('sun-down-at-landing');
    times.push(0);
  }
  if (profile.needEarthAtLanding && !(earthFrac[L] >= threshold)) {
    failures.push('earth-down-at-landing');
    times.push(0);
  }
  if (longestSun >= m && firstDarkBreak !== null) {
    failures.push('dark-gap');
    times.push((firstDarkBreak - L) * stepH + profile.maxDarkGapHours);
  }
  if (earthShare < profile.minEarthShare - EPS) {
    failures.push('earth-share');
    // The moment the accumulated Earth-down time passes what the profile allows.
    const allowed = (1 - profile.minEarthShare) * cnt;
    let down = 0;
    for (let i = L; i < end; i++) {
      if (earthFrac[i] >= threshold) continue;
      if (down + 1 > allowed + EPS) {
        times.push((i - L) * stepH + (allowed - down) * stepH);
        break;
      }
      down++;
    }
  }

  // Sunset / Earthset: null if the body stays up to the end of the stay.
  const firstSet = (frac: ArrayLike<number>): number | null => {
    const d = timeToNextDrop(frac, L, stepMs, threshold);
    if (d === null || L + Math.ceil(d / stepMs - EPS) >= end) return null;
    return d / HOUR_MS;
  };

  return {
    ok: failures.length === 0,
    failures,
    sunShare, earthShare, bothShare,
    longestDarkGapH: longestSun * stepH,
    longestEarthGapH: longestEarth * stepH,
    firstSunsetAfterH: firstSet(sunFrac),
    firstEarthsetAfterH: firstSet(earthFrac),
    firstFailureAfterH: times.length ? Math.min(...times) : null,
  };
}

export interface SlipScan {
  startMs: number;
  stepMs: number;
  n: number;
  /** Per candidate landing time: 0 ok, 1 Sun requirement fails, 2 Earth requirement fails, 3 both. */
  code: Uint8Array;
}

/**
 * Evaluate every candidate landing index in [fromIndex, toIndex), every strideSteps samples.
 * Candidates whose stay would run past the series end are not included.
 * Uses prefix sums, so each candidate costs O(1) whatever the length of the stay.
 */
export function slipScan(
  series: SiteSeries,
  profile: MissionProfile,
  fromIndex: number,
  toIndex: number,
  strideSteps: number,
  threshold = 0.5,
): SlipScan {
  const { n: len, stepMs, sunFrac, earthFrac } = series;
  const cnt = stayCount(profile, stepMs);
  const m = breakRun(profile, stepMs);

  // Prefix counts of samples with Earth up, and of samples that start a dark run of m samples.
  const earthUpPre = new Int32Array(len + 1);
  const sunDownPre = new Int32Array(len + 1);
  for (let i = 0; i < len; i++) {
    earthUpPre[i + 1] = earthUpPre[i] + (earthFrac[i] >= threshold ? 1 : 0);
    sunDownPre[i + 1] = sunDownPre[i] + (sunFrac[i] >= threshold ? 0 : 1);
  }
  const breakPre = new Int32Array(len + 2);
  for (let i = 0; i < len; i++) {
    const starts = i + m <= len && sunDownPre[i + m] - sunDownPre[i] === m;
    breakPre[i + 1] = breakPre[i] + (starts ? 1 : 0);
  }

  const last = Math.min(toIndex, len - cnt + 1); // candidates need L + cnt <= len
  const total = Math.max(0, Math.ceil((last - fromIndex) / strideSteps));
  const code = new Uint8Array(total);
  for (let k = 0; k < total; k++) {
    const L = fromIndex + k * strideSteps;
    let c = 0;
    // Dark runs of m samples that fit inside the stay start at L .. L + cnt - m.
    const darkGap = cnt >= m && breakPre[L + cnt - m + 1] - breakPre[L] > 0;
    if ((profile.needSunAtLanding && !(sunFrac[L] >= threshold)) || darkGap) c |= 1;
    const earthShare = (earthUpPre[L + cnt] - earthUpPre[L]) / cnt;
    if ((profile.needEarthAtLanding && !(earthFrac[L] >= threshold)) || earthShare < profile.minEarthShare - EPS) c |= 2;
    code[k] = c;
  }
  return { startMs: series.startMs + fromIndex * stepMs, stepMs: strideSteps * stepMs, n: total, code };
}

/**
 * How long the landing can be delayed with every candidate from landingMs onward still ok,
 * measured to the last ok candidate (so one ok candidate followed by a failure gives 0, the
 * same as a failing landingMs). If every candidate to the end of the scan is ok, runs to the
 * last one. 0 if landingMs lies outside the scan.
 */
export function slipMarginMs(scan: SlipScan, landingMs: number): number {
  const k = Math.round((landingMs - scan.startMs) / scan.stepMs);
  if (k < 0 || k >= scan.n || scan.code[k] !== 0) return 0;
  let j = k;
  while (j + 1 < scan.n && scan.code[j + 1] === 0) j++;
  return (j - k) * scan.stepMs;
}

/** The next run of ok candidates starting at or after afterMs; endMs is the last ok candidate. */
export function nextWindow(scan: SlipScan, afterMs: number): Interval | null {
  let k = Math.max(0, Math.ceil((afterMs - scan.startMs) / scan.stepMs - EPS));
  while (k < scan.n && scan.code[k] !== 0) k++;
  if (k >= scan.n) return null;
  let j = k;
  while (j + 1 < scan.n && scan.code[j + 1] === 0) j++;
  return { startMs: scan.startMs + k * scan.stepMs, endMs: scan.startMs + j * scan.stepMs };
}
