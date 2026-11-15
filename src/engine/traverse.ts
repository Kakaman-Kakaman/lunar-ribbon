// Rover traverses (docs/PLAN-V2.md E10): a path in the polar stereographic plane, driven at a constant
// speed from a start time. At each time step: the rover's position, the ground slope there, the
// skyline from that spot, and how much of the Sun and Earth it sees. After the end of the path the
// rover stays at the last point until maxSamples.

import { EARTH_RADIUS_KM, SUN_RADIUS_KM, angularRadiusDeg, siteBasis, skyPosition } from './ephemeris';
import { horizonProfile, sampleTerrain, xyToLL, type NestedGrid, type Pole } from './raymarch';
import { discFractionAboveSkyline, type FrameCache } from './visibility';

export type XY = [number, number];

export function pathLength(path: XY[]): number {
  let d = 0;
  for (let k = 1; k < path.length; k++) d += Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
  return d;
}

/** The point at distance d along the path (clamped to its ends). Distances are in the projected plane. */
export function pointAlong(path: XY[], d: number): XY {
  if (path.length === 1 || d <= 0) return path[0];
  for (let k = 1; k < path.length; k++) {
    const seg = Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    if (d <= seg) {
      const f = seg === 0 ? 0 : d / seg;
      return [path[k - 1][0] + f * (path[k][0] - path[k - 1][0]), path[k - 1][1] + f * (path[k][1] - path[k - 1][1])];
    }
    d -= seg;
  }
  return path[path.length - 1];
}

function heightAt(grids: NestedGrid[], x: number, y: number): number {
  for (const g of grids) {
    const z = sampleTerrain(g.grid, x, y);
    if (!Number.isNaN(z)) return z;
  }
  return NaN;
}

/** Ground slope in degrees at (x, y), by central differences over one pixel of the finest grid there. */
export function slopeAt(grids: NestedGrid[], x: number, y: number): number {
  const g = grids.find((n) => !Number.isNaN(sampleTerrain(n.grid, x, y)));
  if (!g) return NaN;
  const h = g.grid.scaleM;
  const dzdx = (heightAt(grids, x + h, y) - heightAt(grids, x - h, y)) / (2 * h);
  const dzdy = (heightAt(grids, x, y + h) - heightAt(grids, x, y - h)) / (2 * h);
  return (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
}

export interface TraverseOptions {
  path: XY[];
  pole?: Pole;
  speedMps: number;
  startMs: number;
  stepMs: number;
  heightM: number;
  grids: NestedGrid[];
  /** Number of samples; default: until the end of the path. */
  maxSamples?: number;
  azStepDeg?: number;
  maxKm?: number;
}

export interface TraverseSample {
  ms: number;
  distM: number;
  x: number;
  y: number;
  lat: number;
  lon: number;
  groundM: number;
  slopeDeg: number;
  sunAz: number;
  sunEl: number;
  sunFrac: number;
  earthAz: number;
  earthEl: number;
  earthFrac: number;
  arrived: boolean;
}

export function traverse(o: TraverseOptions, frames: FrameCache): TraverseSample[] {
  const len = pathLength(o.path);
  const stepM = o.speedMps * (o.stepMs / 1000);
  const n = o.maxSamples ?? (stepM > 0 ? Math.ceil(len / stepM) + 1 : 1);
  const az = o.azStepDeg ?? 1;
  const pole = o.pole ?? 'south';
  const out: TraverseSample[] = [];
  for (let k = 0; k < n; k++) {
    const distM = Math.min(len, k * stepM);
    const [x, y] = pointAlong(o.path, distM);
    const [lat, lon] = xyToLL(x, y, pole);
    const hp = horizonProfile({ lat, lon, heightsM: [o.heightM], near: null, far: null, azStepDeg: az, maxKm: o.maxKm, grids: o.grids });
    const ms = o.startMs + k * o.stepMs;
    const f = frames.get(ms);
    const basis = siteBasis(lon, lat, (hp.groundElevM + o.heightM) / 1000);
    const s = skyPosition(basis, f.sun), e = skyPosition(basis, f.earth);
    const profile = hp.horizonDeg[0];
    out.push({
      ms, distM, x, y, lat, lon, groundM: hp.groundElevM, slopeDeg: slopeAt(o.grids, x, y),
      sunAz: s.az, sunEl: s.el, sunFrac: discFractionAboveSkyline(s.az, s.el, angularRadiusDeg(SUN_RADIUS_KM, s.distKm), profile, az),
      earthAz: e.az, earthEl: e.el, earthFrac: discFractionAboveSkyline(e.az, e.el, angularRadiusDeg(EARTH_RADIUS_KM, e.distKm), profile, az),
      arrived: distM >= len,
    });
  }
  return out;
}
