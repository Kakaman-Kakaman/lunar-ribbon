// Terrain skyline ("horizon mask") ray-marcher for lunar south polar DEMs.
// Pure TypeScript, no imports, erasable syntax only: runs in Node (type stripping) and the browser.

export const MOON_RADIUS_M = 1737400;

const DEG = Math.PI / 180;

/** Square elevation grid in south polar stereographic projection (row 0 at the top, +y up). */
export interface DemGrid {
  /** Heights in grid units (16-bit LOLA products) or metres (float products, with dnToM = 1); NaN means no data. */
  data: Int16Array | Float32Array;
  size: number;
  scaleM: number;
  dnToM: number;
  /** Pole position in 0-based pixel coordinates (pixel centres at integers), e.g. 3799.5. */
  offsetPx: number;
}

/** South polar stereographic, centre lat -90, centre lon 0, east-positive. x = rho sin(lon), y = rho cos(lon). */
export function llToXY(latDeg: number, lonDeg: number): [number, number] {
  const rho = 2 * MOON_RADIUS_M * Math.tan(Math.PI / 4 + (latDeg * DEG) / 2);
  const lon = lonDeg * DEG;
  return [rho * Math.sin(lon), rho * Math.cos(lon)];
}

/** Inverse of llToXY. Returns [latDeg, lonDeg in -180..180]. */
export function xyToLL(x: number, y: number): [number, number] {
  const rho = Math.hypot(x, y);
  const lat = 2 * Math.atan(rho / (2 * MOON_RADIUS_M)) - Math.PI / 2;
  const lon = rho === 0 ? 0 : Math.atan2(x, y);
  return [lat / DEG, lon / DEG];
}

/** Bilinear height in metres at projected position (x, y); NaN outside the grid. */
export function sampleDem(grid: DemGrid, x: number, y: number): number {
  const col = x / grid.scaleM + grid.offsetPx;
  const row = grid.offsetPx - y / grid.scaleM;
  const n = grid.size;
  if (!(col >= 0 && row >= 0 && col <= n - 1 && row <= n - 1)) return NaN;
  let c0 = Math.floor(col);
  let r0 = Math.floor(row);
  if (c0 > n - 2) c0 = n - 2;
  if (r0 > n - 2) r0 = n - 2;
  const fc = col - c0;
  const fr = row - r0;
  const d = grid.data;
  const i = r0 * n + c0;
  const top = d[i] * (1 - fc) + d[i + 1] * fc;
  const bot = d[i + n] * (1 - fc) + d[i + n + 1] * fc;
  return (top * (1 - fr) + bot * fr) * grid.dnToM;
}

/** One level of a nested terrain stack: used for samples within `maxKm` of the observer (no limit if absent). */
export interface NestedGrid {
  grid: DemGrid;
  maxKm?: number;
}

export interface HorizonOptions {
  lat: number;
  lon: number;
  heightsM: number[];
  near: DemGrid | null;
  far: DemGrid | null;
  /**
   * Nested terrain, finest first. When given, `near`, `far` and `nearLimitKm` are ignored: each
   * sample uses the finest grid that covers it, and the step along a ray follows that grid's
   * resolution near the observer and the azimuth spacing farther out, so samples along a ray are
   * never farther apart than neighbouring rays.
   */
  grids?: NestedGrid[];
  /**
   * Also return the ridge crests in front of the skyline, for depth. A crest is where a visible
   * stretch of terrain ends because the ground beyond it drops out of sight. Crests rising less
   * than `minGainDeg` above the previous kept crest are dropped, and at most `max` are kept per
   * azimuth (the skyline itself is always the last).
   */
  ridges?: { minGainDeg?: number; max?: number };
  nearLimitKm?: number;
  maxKm?: number;
  azStepDeg?: number;
}

export interface HorizonResult {
  groundElevM: number;
  /** [heightIndex][azIndex]; az = azIndex * azStepDeg, clockwise from north. */
  horizonDeg: number[][];
  /** Ground distance (km) at which the skyline maximum occurred, same indexing. */
  distKm: number[][];
  /** With `ridges`: [heightIndex][azIndex] = crests near to far as [distKm, elevationDeg]; the last is the skyline. */
  ridges?: [number, number][][][];
}

/** Keeps crests that rise at least minGain above the previous kept one, then the `max` with the largest rise; the skyline stays last. */
function thinCrests(c: [number, number][], minGainDeg: number, max: number): [number, number][] {
  if (c.length === 0) return c;
  const sky = c[c.length - 1];
  const kept: [number, number][] = [];
  let prev = -Infinity;
  for (let i = 0; i < c.length - 1; i++) {
    if (c[i][1] - prev >= minGainDeg && sky[1] - c[i][1] >= minGainDeg) {
      kept.push(c[i]);
      prev = c[i][1];
    }
  }
  kept.push(sky);
  while (kept.length > max) {
    let worst = 0;
    let worstGain = Infinity;
    for (let i = 0; i < kept.length - 1; i++) {
      const gain = kept[i][1] - (i === 0 ? -Infinity : kept[i - 1][1]);
      const next = kept[i + 1][1] - kept[i][1];
      const g = Math.min(gain, next);
      if (g < worstGain) { worstGain = g; worst = i; }
    }
    kept.splice(worst, 1);
  }
  return kept;
}

function nestedHeightAt(grids: NestedGrid[], x: number, y: number, distM: number): number {
  for (const g of grids) {
    if (g.maxKm !== undefined && distM > g.maxKm * 1000) continue;
    const z = sampleDem(g.grid, x, y);
    if (!Number.isNaN(z)) return z;
  }
  return NaN;
}

function heightAt(o: HorizonOptions, x: number, y: number, useNear: boolean): number {
  if (o.near === null && o.far === null) return 0;
  let z = NaN;
  if (useNear && o.near !== null) z = sampleDem(o.near, x, y);
  if (Number.isNaN(z) && o.far !== null) z = sampleDem(o.far, x, y);
  if (Number.isNaN(z) && o.near !== null) z = sampleDem(o.near, x, y);
  return z;
}

export function horizonProfile(o: HorizonOptions): HorizonResult {
  const R = MOON_RADIUS_M;
  const nearLimitM = (o.nearLimitKm ?? 60) * 1000;
  const maxM = (o.maxKm ?? 200) * 1000;
  const azStep = o.azStepDeg ?? 0.5;
  const nAz = Math.round(360 / azStep);
  const nH = o.heightsM.length;
  const nested = o.grids !== undefined && o.grids.length > 0 ? o.grids : null;
  const bare = nested === null && o.near === null && o.far === null;

  const [sx, sy] = llToXY(o.lat, o.lon);
  const z0raw = bare ? 0 : nested ? nestedHeightAt(nested, sx, sy, 0) : heightAt(o, sx, sy, true);
  const z0 = Number.isNaN(z0raw) ? 0 : z0raw;

  const lat1 = o.lat * DEG;
  const lon1 = o.lon * DEG;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);

  // Precompute distance ladder and its trig once; it is the same for every azimuth.
  const dists: number[] = [];
  if (nested) {
    // Finest grid that covers the observer sets the near-field step (half a pixel); farther out the
    // step grows with distance so it matches the gap between neighbouring rays.
    const local = nested.find((g) => !Number.isNaN(sampleDem(g.grid, sx, sy))) ?? nested[nested.length - 1];
    const minStep = local.grid.scaleM / 2;
    const azRad = azStep * DEG;
    for (let d = minStep; d <= maxM; d += Math.max(minStep, azRad * d)) dists.push(d);
  } else {
    for (let d = 40; d <= maxM; d += Math.max(40, 0.003 * d)) dists.push(d);
  }
  const nD = dists.length;
  const sinT = new Float64Array(nD);
  const cosT = new Float64Array(nD);
  for (let k = 0; k < nD; k++) {
    const t = dists[k] / R;
    sinT[k] = Math.sin(t);
    cosT[k] = Math.cos(t);
  }

  const horizonDeg: number[][] = [];
  const distKm: number[][] = [];
  for (let h = 0; h < nH; h++) {
    horizonDeg.push(new Array<number>(nAz).fill(-90));
    distKm.push(new Array<number>(nAz).fill(0));
  }
  const best = new Float64Array(nH);
  const bestD = new Float64Array(nH);
  const wantRidges = o.ridges !== undefined;
  const minGain = o.ridges?.minGainDeg ?? 0.05;
  const maxRidges = o.ridges?.max ?? 8;
  const ridges: [number, number][][][] | undefined = wantRidges ? Array.from({ length: nH }, () => new Array(nAz)) : undefined;
  const rising = new Uint8Array(nH);
  const crests: [number, number][][] = Array.from({ length: nH }, () => []);

  for (let ia = 0; ia < nAz; ia++) {
    const a = ia * azStep * DEG;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);
    best.fill(-Math.PI);
    bestD.fill(0);
    if (wantRidges) { rising.fill(0); for (const c of crests) c.length = 0; }
    for (let k = 0; k < nD; k++) {
      const st = sinT[k];
      const ct = cosT[k];
      const sinLat2 = sinLat1 * ct + cosLat1 * st * cosA;
      const lat2 = Math.asin(sinLat2 > 1 ? 1 : sinLat2 < -1 ? -1 : sinLat2);
      const lon2 = lon1 + Math.atan2(sinA * st * cosLat1, ct - sinLat1 * sinLat2);
      let z = 0;
      if (!bare) {
        const [x, y] = llToXY(lat2 / DEG, lon2 / DEG);
        z = nested ? nestedHeightAt(nested, x, y, dists[k]) : heightAt(o, x, y, dists[k] <= nearLimitM);
        if (Number.isNaN(z)) continue;
      }
      const num = (R + z) * ct;
      const den = (R + z) * st;
      for (let h = 0; h < nH; h++) {
        const e = Math.atan2(num - (R + z0 + o.heightsM[h]), den);
        if (e > best[h]) {
          best[h] = e;
          bestD[h] = dists[k];
          if (wantRidges) rising[h] = 1;
        } else if (wantRidges && rising[h]) {
          // The visible stretch just ended: the previous new maximum is a crest.
          crests[h].push([bestD[h] / 1000, best[h] / DEG]);
          rising[h] = 0;
        }
      }
    }
    for (let h = 0; h < nH; h++) {
      horizonDeg[h][ia] = best[h] / DEG;
      distKm[h][ia] = bestD[h] / 1000;
      if (ridges) {
        if (rising[h]) crests[h].push([bestD[h] / 1000, best[h] / DEG]);
        ridges[h][ia] = thinCrests(crests[h], minGain, maxRidges);
      }
    }
  }
  return ridges ? { groundElevM: z0, horizonDeg, distKm, ridges } : { groundElevM: z0, horizonDeg, distKm };
}
