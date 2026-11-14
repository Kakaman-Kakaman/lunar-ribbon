// Terrain skyline ("horizon mask") ray-marcher for lunar south polar DEMs.
// Pure TypeScript, no imports, erasable syntax only: runs in Node (type stripping) and the browser.

export const MOON_RADIUS_M = 1737400;

const DEG = Math.PI / 180;

/** Square elevation grid in south polar stereographic projection (row 0 at the top, +y up). */
export interface DemGrid {
  data: Int16Array;
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

export interface HorizonOptions {
  lat: number;
  lon: number;
  heightsM: number[];
  near: DemGrid | null;
  far: DemGrid | null;
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
  const bare = o.near === null && o.far === null;

  const [sx, sy] = llToXY(o.lat, o.lon);
  const z0raw = bare ? 0 : heightAt(o, sx, sy, true);
  const z0 = Number.isNaN(z0raw) ? 0 : z0raw;

  const lat1 = o.lat * DEG;
  const lon1 = o.lon * DEG;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);

  // Precompute distance ladder and its trig once; it is the same for every azimuth.
  const dists: number[] = [];
  for (let d = 40; d <= maxM; d += Math.max(40, 0.003 * d)) dists.push(d);
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

  for (let ia = 0; ia < nAz; ia++) {
    const a = ia * azStep * DEG;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);
    best.fill(-Math.PI);
    bestD.fill(0);
    for (let k = 0; k < nD; k++) {
      const st = sinT[k];
      const ct = cosT[k];
      const sinLat2 = sinLat1 * ct + cosLat1 * st * cosA;
      const lat2 = Math.asin(sinLat2 > 1 ? 1 : sinLat2 < -1 ? -1 : sinLat2);
      const lon2 = lon1 + Math.atan2(sinA * st * cosLat1, ct - sinLat1 * sinLat2);
      let z = 0;
      if (!bare) {
        const [x, y] = llToXY(lat2 / DEG, lon2 / DEG);
        z = heightAt(o, x, y, dists[k] <= nearLimitM);
        if (Number.isNaN(z)) continue;
      }
      const num = (R + z) * ct;
      const den = (R + z) * st;
      for (let h = 0; h < nH; h++) {
        const e = Math.atan2(num - (R + z0 + o.heightsM[h]), den);
        if (e > best[h]) {
          best[h] = e;
          bestD[h] = dists[k];
        }
      }
    }
    for (let h = 0; h < nH; h++) {
      horizonDeg[h][ia] = best[h] / DEG;
      distKm[h][ia] = bestD[h] / 1000;
    }
  }
  return { groundElevM: z0, horizonDeg, distKm };
}
