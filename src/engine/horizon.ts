// Terrain skyline of a landing site, as a table of horizon elevations by azimuth.
//
// A HorizonMask holds, for each observer height, the elevation of the skyline at every
// azimuth step (clockwise from north). The real masks are built from LOLA terrain by the
// pipeline; smoothSphereMask is the no-terrain fallback, where the skyline is only the
// geometric dip of the horizon below the local horizontal plane.

import { MOON_RADIUS_KM } from './ephemeris';

const R2D = 180 / Math.PI;

export interface HorizonMask {
  id: string;
  name: string;
  lat: number;
  /** East-positive, -180..180. */
  lon: number;
  groundElevM: number | null;
  terrain: 'goddard-2023-20m' | 'lola-10m' | 'lola-20m' | 'lola-80m+240m' | 'lola-240m' | 'lola-480m' | 'smooth-sphere';
  azStepDeg: number;
  /** Observer heights above the ground that the mask was computed for, metres. */
  heightsM: number[];
  /** Key = height in metres as a string. Index i is azimuth i * azStepDeg, clockwise from north. */
  horizonDeg: Record<string, number[]>;
  /** Distance to the terrain that sets the skyline, same keys and indexing as horizonDeg. */
  distKm?: Record<string, number[]>;
}

/** Skyline elevation at an azimuth: linear interpolation between table entries, wrapping at 360. */
export function horizonAt(profile: ArrayLike<number>, azStepDeg: number, azDeg: number): number {
  const n = profile.length;
  const a = (((azDeg % 360) + 360) % 360) / azStepDeg;
  const i0 = Math.floor(a);
  const f = a - i0;
  const lo = profile[i0 % n];
  const hi = profile[(i0 + 1) % n];
  return lo + (hi - lo) * f;
}

/** A mask with no terrain: every azimuth sits at the horizon dip -acos(R / (R + h)). */
export function smoothSphereMask(
  id: string,
  name: string,
  lat: number,
  lon: number,
  heightsM: number[],
): HorizonMask {
  const azStepDeg = 0.5;
  const horizonDeg: Record<string, number[]> = {};
  for (const h of heightsM) {
    const dip = -Math.acos(MOON_RADIUS_KM / (MOON_RADIUS_KM + h / 1000)) * R2D;
    horizonDeg[String(h)] = new Array<number>(360 / azStepDeg).fill(dip);
  }
  return { id, name, lat, lon, groundElevM: null, terrain: 'smooth-sphere', azStepDeg, heightsM: [...heightsM], horizonDeg };
}
