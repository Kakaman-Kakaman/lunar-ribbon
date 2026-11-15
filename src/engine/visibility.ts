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

/** Integral of sqrt(r^2 - x^2) from 0 to x, for |x| <= r. */
function halfChordIntegral(x: number, r: number): number {
  const c = Math.max(-r, Math.min(r, x));
  return 0.5 * (c * Math.sqrt(Math.max(0, r * r - c * c)) + r * r * Math.asin(c / r));
}

/** Area of the part of a disc (radius r, centre at height 0) above height k, between horizontal offsets x0 and x1. */
function stripAreaAbove(x0: number, x1: number, r: number, k: number): number {
  const G = (x: number) => halfChordIntegral(x, r);
  if (k >= r) return 0;
  if (k <= -r) return 2 * (G(x1) - G(x0));
  const xb = Math.sqrt(r * r - k * k);
  // Where |x| < xb the line crosses the chord: area above is c(x) - k.
  const a = Math.max(x0, -xb), b = Math.min(x1, xb);
  let area = b > a ? G(b) - G(a) - k * (b - a) : 0;
  // Where |x| >= xb the chord is entirely above (k < 0) or entirely below (k > 0) the line.
  if (k < 0) {
    if (x0 < -xb) area += 2 * (G(Math.min(x1, -xb)) - G(x0));
    if (x1 > xb) area += 2 * (G(x1) - G(Math.max(x0, xb)));
  }
  return area;
}

/** Number of vertical strips a disc is cut into when the skyline under it is not flat. */
export const DISC_STRIPS = 16;

/**
 * Fraction of a disc above the actual skyline under it. The disc (centre azimuth azDeg, elevation
 * elDeg, angular radius radiusDeg) is cut into vertical strips; under each strip the skyline is
 * taken at the strip's centre azimuth, and the area above it is integrated exactly. A flat skyline
 * gives exactly discFractionAbove. Horizontal offsets on the sky map to azimuth by 1/cos(elevation).
 */
export function discFractionAboveSkyline(
  azDeg: number,
  elDeg: number,
  radiusDeg: number,
  profile: ArrayLike<number>,
  azStepDeg: number,
  strips = DISC_STRIPS,
): number {
  const r = radiusDeg;
  const cosEl = Math.cos((elDeg * Math.PI) / 180);
  if (cosEl < 0.05) return discFractionAbove(elDeg, r, horizonAt(profile, azStepDeg, azDeg));
  let area = 0;
  const w = (2 * r) / strips;
  for (let i = 0; i < strips; i++) {
    const x0 = -r + i * w, x1 = x0 + w;
    const h = horizonAt(profile, azStepDeg, azDeg + (x0 + x1) / 2 / cosEl);
    area += stripAreaAbove(x0, x1, r, h - elDeg);
  }
  return Math.min(1, Math.max(0, area / (Math.PI * r * r)));
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
    s.sunFrac[i] = discFractionAboveSkyline(sun.az, sun.el, sunR, profile, mask.azStepDeg);
    s.earthAz[i] = earth.az;
    s.earthEl[i] = earth.el;
    s.earthHorizon[i] = earthH;
    const earthR = angularRadiusDeg(EARTH_RADIUS_KM, earth.distKm);
    s.earthFrac[i] = discFractionAboveSkyline(earth.az, earth.el, earthR, profile, mask.azStepDeg);
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
