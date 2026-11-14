// Geometry for the sky chart: azimuth along x, elevation along y.
//
// Turns a SiteSeries into the shapes the chart draws: the band the Sun (or Earth) sweeps
// out per azimuth, the path of a body over a stretch of time, a tick for each day after
// landing, and the spans of darkness with the Sun's azimuth at each end.

import type { SiteSeries } from './visibility';

const DAY_MS = 86400000;

/** Min and max elevation of a body's centre per 1-degree azimuth bin; NaN where it never goes. */
export interface Envelope {
  /** Bin centres: 0.5, 1.5, ... 359.5. */
  azDeg: Float32Array;
  minEl: Float32Array;
  maxEl: Float32Array;
}

/** Elevation range of a body in each azimuth bin over samples [from, to). */
export function azimuthEnvelope(az: Float32Array, el: Float32Array, from: number, to: number): Envelope {
  const azDeg = new Float32Array(360);
  const minEl = new Float32Array(360).fill(NaN);
  const maxEl = new Float32Array(360).fill(NaN);
  for (let b = 0; b < 360; b++) azDeg[b] = b + 0.5;
  const end = Math.min(to, az.length, el.length);
  for (let i = Math.max(0, from); i < end; i++) {
    const a = az[i], e = el[i];
    if (Number.isNaN(a) || Number.isNaN(e)) continue;
    const b = ((Math.floor(a) % 360) + 360) % 360;
    if (!(e >= minEl[b])) minEl[b] = e; // true when minEl[b] is NaN or e is lower
    if (!(e <= maxEl[b])) maxEl[b] = e;
  }
  return { azDeg, minEl, maxEl };
}

export interface PathPoint {
  ms: number;
  az: number;
  el: number;
  /** Fraction of the body's disc above the skyline. */
  frac: number;
}

type Body = 'sun' | 'earth';

const fields = (s: SiteSeries, body: Body) =>
  body === 'sun'
    ? { az: s.sunAz, el: s.sunEl, frac: s.sunFrac }
    : { az: s.earthAz, el: s.earthEl, frac: s.earthFrac };

/** Position of a body at samples from, from + stride, ... below `to`. */
export function bodyPath(series: SiteSeries, body: Body, from: number, to: number, stride: number): PathPoint[] {
  const f = fields(series, body);
  const out: PathPoint[] = [];
  const end = Math.min(to, series.n);
  for (let i = Math.max(0, from); i < end; i += Math.max(1, stride)) {
    out.push({ ms: series.startMs + i * series.stepMs, az: f.az[i], el: f.el[i], frac: f.frac[i] });
  }
  return out;
}

export interface DayTick {
  ms: number;
  az: number;
  el: number;
  /** Days after landing; 0 is landing. */
  day: number;
}

/** The body's position every 24 hours after landing, for day 0 up to `days`, while the series lasts. */
export function dayTicks(series: SiteSeries, body: Body, landingIndex: number, days: number): DayTick[] {
  const f = fields(series, body);
  const out: DayTick[] = [];
  for (let d = 0; d <= days; d++) {
    const i = landingIndex + Math.round((d * DAY_MS) / series.stepMs);
    if (i < 0 || i >= series.n) break;
    out.push({ ms: series.startMs + i * series.stepMs, az: f.az[i], el: f.el[i], day: d });
  }
  return out;
}

export interface DarkSpan {
  startMs: number;
  endMs: number;
  /** The Sun's azimuth at each end of the span. */
  azStart: number;
  azEnd: number;
  days: number;
}

/** Azimuth a fraction t of the way from a0 to a1, going the short way round 360. */
function lerpAz(a0: number, a1: number, t: number): number {
  let d = a1 - a0;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return (((a0 + d * t) % 360) + 360) % 360;
}

/**
 * Runs over samples [from, to) where the Sun is not up (frac below threshold), with the
 * crossing times interpolated and the Sun's azimuth at each end. A run that is already
 * going at `from`, or still going at the last sample, ends at that sample.
 */
export function darkSpans(series: SiteSeries, from: number, to: number, threshold = 0.5): DarkSpan[] {
  const { sunFrac: fr, sunAz: az, startMs, stepMs } = series;
  const out: DarkSpan[] = [];
  const lo = Math.max(0, from);
  const hi = Math.min(to, series.n);
  type Pt = { ms: number; az: number };
  let start = null as Pt | null;
  const close = (s0: Pt, ms: number, a: number) => {
    out.push({ startMs: s0.ms, endMs: ms, azStart: s0.az, azEnd: a, days: (ms - s0.ms) / DAY_MS });
    start = null;
  };
  for (let i = lo; i < hi; i++) {
    const down = fr[i] < threshold;
    if (down && !start) {
      if (i === lo) {
        start = { ms: startMs + i * stepMs, az: az[i] };
      } else {
        // Sun goes from up at i-1 to down at i: crossing where frac passes the threshold.
        const t = (fr[i - 1] - threshold) / (fr[i - 1] - fr[i]);
        start = { ms: startMs + (i - 1 + t) * stepMs, az: lerpAz(az[i - 1], az[i], t) };
      }
    } else if (!down && start) {
      const t = (threshold - fr[i - 1]) / (fr[i] - fr[i - 1]);
      close(start, startMs + (i - 1 + t) * stepMs, lerpAz(az[i - 1], az[i], t));
    }
  }
  if (start) close(start, startMs + (hi - 1) * stepMs, az[hi - 1]);
  return out;
}
