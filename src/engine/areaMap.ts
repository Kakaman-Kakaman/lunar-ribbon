// Sunlight and Earth-view maps over an area (docs/PLAN-V2.md E8).
//
// A region is a square lattice of points in the south polar stereographic plane. Each point stores
// its ground height and a skyline at 1 degree azimuth steps, quantised to one byte: elevation =
// ELEV_MIN_DEG + byte * ELEV_STEP_DEG (-5 to +20.5 degrees; values outside are clamped, which does
// not change a verdict near the pole, where the Sun stays within about 2 degrees of level).
// shareMap counts, for any date range, the share of samples with the Sun's or Earth's centre at or
// above the skyline, with the Sun and Earth directions computed for each point, because they shift
// by up to about 0.7 degrees across 20 km.

import { siteBasis, skyPosition } from './ephemeris';
import { horizonAt } from './horizon';
import { unpackInt16 } from './maskV2';
import { xyToLL } from './raymarch';
import type { FrameCache } from './visibility';

export const AREA_AZ_STEP_DEG = 1;
export const ELEV_MIN_DEG = -5;
export const ELEV_STEP_DEG = 0.1;
const N_AZ = 360 / AREA_AZ_STEP_DEG;

export interface AreaGrid {
  id: string;
  /** Projected centre and lattice spacing, metres; point (i, j) is at x = cx + (i - (n-1)/2) * spacing, y = cy - (j - (n-1)/2) * spacing. */
  cx: number;
  cy: number;
  spacingM: number;
  n: number;
  heightM: number;
  terrain: string[];
  /** Base64 Int16 ground heights, metres, n * n, row-major (j then i). */
  ground: string;
  /** Base64 bytes, n * n * 360: skyline of point (i, j) at azimuth a is byte [(j * n + i) * 360 + a]. */
  skyline: string;
}

export const quantiseElev = (deg: number) => Math.max(0, Math.min(255, Math.round((deg - ELEV_MIN_DEG) / ELEV_STEP_DEG)));
export const dequantiseElev = (b: number) => ELEV_MIN_DEG + b * ELEV_STEP_DEG;

export function packBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unpackBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function pointXY(g: Pick<AreaGrid, 'cx' | 'cy' | 'spacingM' | 'n'>, i: number, j: number): [number, number] {
  const h = (g.n - 1) / 2;
  return [g.cx + (i - h) * g.spacingM, g.cy - (j - h) * g.spacingM];
}

export interface ShareMap {
  n: number;
  /** Share of samples with the body's centre at or above the skyline, per point (j * n + i). */
  sun: Float32Array;
  earth: Float32Array;
}

/** Sun and Earth shares at every lattice point for n samples from startMs, stepMs apart. */
export function shareMap(g: AreaGrid, startMs: number, stepMs: number, n: number, frames: FrameCache): ShareMap {
  const ground = unpackInt16(g.ground);
  const sky = unpackBytes(g.skyline);
  const pts = g.n * g.n;
  const sun = new Float32Array(pts), earth = new Float32Array(pts);
  const profile = new Float32Array(N_AZ);
  const fs = Array.from({ length: n }, (_, k) => frames.get(startMs + k * stepMs));
  for (let p = 0; p < pts; p++) {
    const i = p % g.n, j = Math.floor(p / g.n);
    const [x, y] = pointXY(g, i, j);
    const [lat, lon] = xyToLL(x, y);
    const basis = siteBasis(lon, lat, (ground[p] + g.heightM) / 1000);
    for (let a = 0; a < N_AZ; a++) profile[a] = dequantiseElev(sky[p * N_AZ + a]);
    let s = 0, e = 0;
    for (const f of fs) {
      const sp = skyPosition(basis, f.sun), ep = skyPosition(basis, f.earth);
      if (sp.el >= horizonAt(profile, AREA_AZ_STEP_DEG, sp.az)) s++;
      if (ep.el >= horizonAt(profile, AREA_AZ_STEP_DEG, ep.az)) e++;
    }
    sun[p] = s / n;
    earth[p] = e / n;
  }
  return { n: g.n, sun, earth };
}
