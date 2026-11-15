// Custom points: a site typed as latitude and longitude.
//
// A custom point travels in the scenario (and the URL) as an id like "pt:-89.4600,-137.3100".
// Inside 80° S its skyline is ray-marched in the browser from the 480 m NASA LOLA grid in
// public/terrain/ (built by pipeline/build-coarse-dem.ts); that grid is coarse, so the result is
// labelled indicative. Elsewhere the Moon is a smooth sphere, labelled as a geometric estimate.

import { horizonProfile, type DemGrid } from '../engine/raymarch';
import { smoothSphereMask, type HorizonMask } from '../engine/horizon';
import type { SiteInfo } from './sites';

export const CUSTOM_PREFIX = 'pt:';
/** The coarse grid covers the pole out to 80° S. */
export const COARSE_LIMIT_LAT = -80;
const HEIGHTS = [1, 2, 5, 10];

export function customId(lat: number, lon: number): string {
  return `${CUSTOM_PREFIX}${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** Latitude and longitude from a custom id, or null if the id is not a valid custom point. */
export function parseCustomId(id: string): { lat: number; lon: number } | null {
  if (!id.startsWith(CUSTOM_PREFIX)) return null;
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(id.slice(CUSTOM_PREFIX.length));
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return null;
  return { lat, lon };
}

const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v < 0 ? neg : pos}`;

export function customSite(id: string): SiteInfo | null {
  const p = parseCustomId(id);
  if (!p) return null;
  const coarse = p.lat <= COARSE_LIMIT_LAT;
  return {
    id,
    name: `Custom point, ${fmt(p.lat, 'N', 'S')}, ${fmt(p.lon, 'E', 'W')}`,
    lat: p.lat,
    lon: p.lon,
    group: 'custom',
    terrain: coarse ? 'lola-480m' : 'smooth-sphere',
    groundElevM: null,
    note: coarse
      ? 'Typed coordinates. The skyline is computed in your browser from a 480 m NASA LOLA grid (the 240 m grid averaged 2 by 2), so hills smaller than about half a kilometre are missing: treat the result as indicative.'
      : 'Typed coordinates outside 80° S, where this app carries no terrain: the skyline is a smooth sphere, so the result is a geometric estimate.',
    source: coarse ? 'NASA LOLA LDEM_60S_240M, averaged to 480 m' : '',
  };
}

let gridPromise: Promise<DemGrid> | null = null;

/** The 480 m south polar grid, fetched once (about 3 MB). */
export function loadCoarseGrid(): Promise<DemGrid> {
  if (!gridPromise) {
    const base = import.meta.env.BASE_URL;
    gridPromise = Promise.all([
      fetch(`${base}terrain/spole_80s_480m.json`).then((r) => {
        if (!r.ok) throw new Error(`Could not load the terrain grid description (HTTP ${r.status}).`);
        return r.json() as Promise<{ size: number; scaleM: number; dnToM: number; offsetPx: number }>;
      }),
      fetch(`${base}terrain/spole_80s_480m.i16`).then((r) => {
        if (!r.ok) throw new Error(`Could not load the terrain grid (HTTP ${r.status}).`);
        return r.arrayBuffer();
      }),
    ]).then(([meta, buf]) => {
      const data = new Int16Array(buf);
      if (data.length !== meta.size * meta.size) throw new Error('The terrain grid has an unexpected size.');
      return { data, size: meta.size, scaleM: meta.scaleM, dnToM: meta.dnToM, offsetPx: meta.offsetPx };
    });
    gridPromise.catch(() => {
      gridPromise = null;
    });
  }
  return gridPromise;
}

/** The skyline mask for a custom point. */
export async function customMask(site: SiteInfo): Promise<HorizonMask> {
  if (site.terrain === 'smooth-sphere') return smoothSphereMask(site.id, site.name, site.lat, site.lon, HEIGHTS);
  const grid = await loadCoarseGrid();
  // Let the loading state paint before the ray-march takes the main thread.
  await new Promise((r) => setTimeout(r, 30));
  const res = horizonProfile({ lat: site.lat, lon: site.lon, heightsM: HEIGHTS, near: null, far: grid, maxKm: 200, azStepDeg: 0.5 });
  const horizonDeg: Record<string, number[]> = {};
  const distKm: Record<string, number[]> = {};
  HEIGHTS.forEach((h, i) => {
    horizonDeg[String(h)] = res.horizonDeg[i].map((v) => Math.round(v * 1000) / 1000);
    distKm[String(h)] = res.distKm[i].map((v) => Math.round(v * 100) / 100);
  });
  return {
    id: site.id,
    name: site.name,
    lat: site.lat,
    lon: site.lon,
    groundElevM: Math.round(res.groundElevM * 10) / 10,
    terrain: 'lola-480m',
    azStepDeg: 0.5,
    heightsM: [...HEIGHTS],
    horizonDeg,
    distKm,
  };
}
