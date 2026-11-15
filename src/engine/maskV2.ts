// Version 2 skyline files: the published point at fine azimuth steps with ridge layers, plus the
// points of the site's sensitivity band (D-043) at coarser steps, for observer heights 1, 2, 5 and
// 10 m (D-044). Numbers are stored as base64 16-bit integers to keep files small:
// elevations in hundredths of a degree, distances in tens of metres.

import type { HorizonMask } from './horizon';

export interface MaskV2Point {
  lat: number;
  lon: number;
  groundElevM: number;
  /** Key = height in metres. Elevations, 0.01 degree units, azStepDeg apart. */
  horizon: Record<string, string>;
}

export interface MaskV2 {
  version: 2;
  id: string;
  name: string;
  lat: number;
  lon: number;
  group: string;
  /** Terrain grids used, finest first. */
  terrain: string[];
  heightsM: number[];
  centre: MaskV2Point & {
    azStepDeg: number;
    /** Distance to the skyline terrain, 10 m units, same layout as horizon. */
    distance: Record<string, string>;
    /** Ridge crests at ridgeAzStepDeg: per azimuth, `ridgeCount` gives how many [dist, elev] pairs follow in `ridges`. */
    ridgeAzStepDeg: number;
    ridgeCount: Record<string, string>;
    ridges: Record<string, string>;
  };
  band: { radiusM: number; roundingRadiusM: number; azStepDeg: number; points: MaskV2Point[] };
  source: string;
  sourceQuality: string;
  note: string;
}

const clamp16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));

/** Packs numbers (already scaled to integer units) as base64 little-endian Int16. */
export function packInt16(values: ArrayLike<number>): string {
  const a = new Int16Array(values.length);
  for (let i = 0; i < values.length; i++) a[i] = clamp16(values[i]);
  const bytes = new Uint8Array(a.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unpackInt16(b64: string): Int16Array {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

/** Skyline in degrees for a point and height. */
export function horizonDegOf(p: MaskV2Point, heightM: number): number[] {
  const packed = p.horizon[String(heightM)];
  if (!packed) throw new Error(`no skyline for height ${heightM} m`);
  return Array.from(unpackInt16(packed), (v) => v / 100);
}

/** Terrain label for a site from the name of the finest grid that covers it. */
export function terrainOfGrid(name: string | undefined): HorizonMask['terrain'] {
  if (!name) return 'smooth-sphere';
  if (/20MPP_ADJ/.test(name)) return 'goddard-2023-20m';
  if (/_10M/.test(name)) return 'lola-10m';
  if (/_20M/.test(name)) return 'lola-20m';
  if (/_240M/.test(name)) return 'lola-240m';
  return 'lola-80m+240m';
}

/** The published point as an engine HorizonMask (all heights), for computeSeries. */
export function centreMask(m: MaskV2, terrain: HorizonMask['terrain'] = 'lola-80m+240m'): HorizonMask {
  const horizonDeg: Record<string, number[]> = {};
  const distKm: Record<string, number[]> = {};
  for (const h of m.heightsM) {
    horizonDeg[String(h)] = horizonDegOf(m.centre, h);
    distKm[String(h)] = Array.from(unpackInt16(m.centre.distance[String(h)]), (v) => v / 100);
  }
  return { id: m.id, name: m.name, lat: m.lat, lon: m.lon, groundElevM: m.centre.groundElevM, terrain, azStepDeg: m.centre.azStepDeg, heightsM: [...m.heightsM], horizonDeg, distKm };
}

/** Band point k (0-based) as an engine HorizonMask. */
export function bandMask(m: MaskV2, k: number, terrain: HorizonMask['terrain'] = 'lola-80m+240m'): HorizonMask {
  const p = m.band.points[k];
  const horizonDeg: Record<string, number[]> = {};
  for (const h of m.heightsM) horizonDeg[String(h)] = horizonDegOf(p, h);
  return { id: `${m.id}#${k}`, name: m.name, lat: p.lat, lon: p.lon, groundElevM: p.groundElevM, terrain, azStepDeg: m.band.azStepDeg, heightsM: [...m.heightsM], horizonDeg };
}

/** Ridge crests for a height: one array of [distKm, elevDeg] per azimuth step, near to far. */
export function ridgesOf(m: MaskV2, heightM: number): [number, number][][] {
  const counts = unpackInt16(m.centre.ridgeCount[String(heightM)]);
  const flat = unpackInt16(m.centre.ridges[String(heightM)]);
  const out: [number, number][][] = [];
  let j = 0;
  for (let i = 0; i < counts.length; i++) {
    const list: [number, number][] = [];
    for (let k = 0; k < counts[i]; k++, j += 2) list.push([flat[j] / 100, flat[j + 1] / 100]);
    out.push(list);
  }
  return out;
}
