// When the Sun and Earth are above a site's skyline.
//
// computeSeries samples the Sun's and Earth's position over time and compares each with the
// terrain skyline at the same azimuth, giving the fraction of each disc that clears it.
// A body counts as "up" when at least half its disc is above the skyline, the convention
// of ESA's lunar lander study (De Rosa et al. 2012). The interval helpers turn a fraction
// series into rise and set times.

import {
  EARTH_RADIUS_KM,
  SUN_RADIUS_KM,
  angularRadiusDeg,
  moonFrame,
  siteBasis,
  skyPosition,
  type MoonFrame,
} from './ephemeris';
import { horizonAt, type HorizonMask } from './horizon';

/** Fraction of a disc's area above a horizontal line (circular segment area over disc area). */
export function discFractionAbove(centreElDeg: number, radiusDeg: number, horizonElDeg: number): number {
  const d = (horizonElDeg - centreElDeg) / radiusDeg;
  if (d <= -1) return 1;
  if (d >= 1) return 0;
  return (Math.acos(d) - d * Math.sqrt(1 - d * d)) / Math.PI;
}

/**
 * Fraction of the Sun's disc hidden behind Earth's disc, for two discs sepDeg apart (small-angle,
 * flat geometry). Seen from the Moon this is an eclipse of the Sun by Earth, which people on Earth
 * see at the same moment as a lunar eclipse.
 */
export function sunCoveredByEarth(sepDeg: number, sunRadiusDeg: number, earthRadiusDeg: number): number {
  const d = sepDeg, r = sunRadiusDeg, R = earthRadiusDeg;
  if (d >= r + R) return 0;
  if (d <= R - r) return 1;
  if (d <= r - R) return (R * R) / (r * r);
  const a =
    r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) +
    R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R)) -
    0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
  return Math.min(1, Math.max(0, a / (Math.PI * r * r)));
}

/** Angle between two sky directions given as azimuth and elevation, degrees. */
export function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const D = Math.PI / 180;
  const c = Math.sin(el1 * D) * Math.sin(el2 * D) + Math.cos(el1 * D) * Math.cos(el2 * D) * Math.cos((az1 - az2) * D);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D;
}

/** Memoises moonFrame per timestamp, so every site shares one ephemeris evaluation per step. */
export class FrameCache {
  private frames = new Map<number, MoonFrame>();

  get(ms: number): MoonFrame {
    let f = this.frames.get(ms);
    if (!f) {
      f = moonFrame(new Date(ms));
      this.frames.set(ms, f);
    }
    return f;
  }
}

export interface SiteSeries {
  startMs: number;
  stepMs: number;
  n: number;
  sunAz: Float32Array;
  sunEl: Float32Array;
  /** Skyline elevation at the Sun's azimuth. */
  sunHorizon: Float32Array;
  /** Fraction of the Sun's disc above the skyline. */
  sunFrac: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
  earthHorizon: Float32Array;
  earthFrac: Float32Array;
  /** Fraction of the Sun's disc hidden behind Earth (an eclipse seen from the Moon). */
  sunCover?: Float32Array;
}

/**
 * Sun and Earth against the skyline for n samples starting at startMs.
 * The observer is heightM above the ground; the mask must hold that height as a key.
 */
export function computeSeries(
  mask: HorizonMask,
  heightM: number,
  startMs: number,
  stepMs: number,
  n: number,
  frames: FrameCache,
): SiteSeries {
  const profile = mask.horizonDeg[String(heightM)];
  if (!profile) {
    throw new Error(`Mask ${mask.id} has no skyline for height ${heightM} m (has ${mask.heightsM.join(', ')})`);
  }
  const site = siteBasis(mask.lon, mask.lat, ((mask.groundElevM ?? 0) + heightM) / 1000);
  const s: SiteSeries = {
    startMs, stepMs, n,
    sunAz: new Float32Array(n), sunEl: new Float32Array(n),
    sunHorizon: new Float32Array(n), sunFrac: new Float32Array(n),
    earthAz: new Float32Array(n), earthEl: new Float32Array(n),
    earthHorizon: new Float32Array(n), earthFrac: new Float32Array(n),
    sunCover: new Float32Array(n),
  };
  for (let i = 0; i < n; i++) {
    const f = frames.get(startMs + i * stepMs);
    const sun = skyPosition(site, f.sun);
    const earth = skyPosition(site, f.earth);
    const sunH = horizonAt(profile, mask.azStepDeg, sun.az);
    const earthH = horizonAt(profile, mask.azStepDeg, earth.az);
    s.sunAz[i] = sun.az;
    s.sunEl[i] = sun.el;
    s.sunHorizon[i] = sunH;
    const sunR = angularRadiusDeg(SUN_RADIUS_KM, sun.distKm);
    s.sunFrac[i] = discFractionAbove(sun.el, sunR, sunH);
    s.earthAz[i] = earth.az;
    s.earthEl[i] = earth.el;
    s.earthHorizon[i] = earthH;
    const earthR = angularRadiusDeg(EARTH_RADIUS_KM, earth.distKm);
    s.earthFrac[i] = discFractionAbove(earth.el, earthR, earthH);
    s.sunCover![i] = sunCoveredByEarth(separationDeg(sun.az, sun.el, earth.az, earth.el), sunR, earthR);
  }
  return s;
}

export interface Interval {
  startMs: number;
  endMs: number;
}

/** Runs where frac >= threshold, with crossing times linearly interpolated between samples. */
export function intervalsAbove(
  frac: ArrayLike<number>,
  startMs: number,
  stepMs: number,
  threshold = 0.5,
): Interval[] {
  const out: Interval[] = [];
  const n = frac.length;
  let runStart: number | null = null;
  for (let i = 0; i < n; i++) {
    const up = frac[i] >= threshold;
    if (up && runStart === null) {
      if (i === 0) {
        runStart = startMs;
      } else {
        const f0 = frac[i - 1], f1 = frac[i];
        runStart = startMs + (i - 1 + (threshold - f0) / (f1 - f0)) * stepMs;
      }
    } else if (!up && runStart !== null) {
      const f0 = frac[i - 1], f1 = frac[i];
      out.push({ startMs: runStart, endMs: startMs + (i - 1 + (f0 - threshold) / (f0 - f1)) * stepMs });
      runStart = null;
    }
  }
  if (runStart !== null) out.push({ startMs: runStart, endMs: startMs + (n - 1) * stepMs });
  return out;
}

/** Milliseconds from sample `index` until frac next falls below threshold; 0 if already below; null if never. */
export function timeToNextDrop(
  frac: ArrayLike<number>,
  index: number,
  stepMs: number,
  threshold = 0.5,
): number | null {
  if (frac[index] < threshold) return 0;
  for (let j = index + 1; j < frac.length; j++) {
    if (frac[j] < threshold) {
      const f0 = frac[j - 1], f1 = frac[j];
      return (j - 1 - index + (f0 - threshold) / (f0 - f1)) * stepMs;
    }
  }
  return null;
}

/** Milliseconds from sample `index` until frac next reaches threshold; 0 if already there; null if never. */
export function timeToNextRise(
  frac: ArrayLike<number>,
  index: number,
  stepMs: number,
  threshold = 0.5,
): number | null {
  if (frac[index] >= threshold) return 0;
  for (let j = index + 1; j < frac.length; j++) {
    if (frac[j] >= threshold) {
      const f0 = frac[j - 1], f1 = frac[j];
      return (j - 1 - index + (threshold - f0) / (f1 - f0)) * stepMs;
    }
  }
  return null;
}
