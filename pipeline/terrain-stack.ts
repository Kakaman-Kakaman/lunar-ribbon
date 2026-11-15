// The terrain the pipeline uses, in one place: the version 1 recipe (80 m near, 240 m far) and the
// version 2 nested stack (finest available grid first, 240 m for the far field).
import { availableNorthGrids, availableSouthGrids, loadLola, type LolaGrid } from './lola.ts';

export interface TerrainStack {
  v1Near: LolaGrid;
  v1Far: LolaGrid;
  /** Finest first. */
  stack: LolaGrid[];
  /** Grids present on disk but not usable (e.g. still downloading), with the reason. */
  skipped: string[];
}

/** Loads every usable south-pole grid. `exclude` names grids to leave out of the nested stack (e.g. comparison-only grids, D-042). */
export function loadTerrainStack(exclude: string[] = ['LDEM_875S_5M']): TerrainStack {
  const grids: LolaGrid[] = [];
  const skipped: string[] = [];
  for (const name of availableSouthGrids()) {
    try {
      grids.push(loadLola(name));
    } catch (e) {
      skipped.push(`${name}: ${(e as Error).message}`);
    }
  }
  const byName = (n: string) => grids.find((g) => g.name === n);
  const v1Near = byName('LDEM_80S_80M');
  const v1Far = byName('LDEM_60S_240M');
  if (!v1Near || !v1Far) throw new Error('need LDEM_80S_80M and LDEM_60S_240M');
  const fine = grids.filter((g) => g.scaleM < 80 && !exclude.includes(g.name)).sort((a, b) => a.scaleM - b.scaleM);
  // The 80 m grid covers the same area as the 20 m grid, so it joins only when no 20 m grid is present.
  const stack = [...fine, ...(fine.some((g) => g.edgeLatDeg >= -80) ? [] : [v1Near]), v1Far];
  return { v1Near, v1Far, stack, skipped: [...skipped, ...exclude.filter((n) => byName(n)).map((n) => `${n}: excluded (comparison only)`)] };
}

/** The north-pole stack: grids finer than 80 m first (when present), then 80 m, then 240 m for the far field. */
export function loadNorthStack(): { stack: LolaGrid[]; skipped: string[] } {
  const grids: LolaGrid[] = [];
  const skipped: string[] = [];
  for (const name of availableNorthGrids()) {
    try {
      grids.push(loadLola(name));
    } catch (e) {
      skipped.push(`${name}: ${(e as Error).message}`);
    }
  }
  const fine = grids.filter((g) => g.scaleM < 80).sort((a, b) => a.scaleM - b.scaleM);
  const g80 = grids.find((g) => g.scaleM === 80), g240 = grids.find((g) => g.scaleM === 240);
  const stack = [...fine, ...(fine.some((g) => g.edgeLatDeg <= 80) || !g80 ? [] : [g80]), ...(g240 ? [g240] : [])];
  return { stack, skipped };
}

/**
 * Radius within which a published coordinate could lie, m: half a unit in the last decimal place
 * of latitude and of longitude (as stored), combined. JSON drops trailing zeros, so this can
 * overstate the rounding of a coordinate such as 31.70.
 */
export function roundingRadiusM(lat: number, lon: number): number {
  const decimals = (v: number) => (String(v).split('.')[1] ?? '').length;
  const mPerDeg = (Math.PI / 180) * 1737400;
  const dLat = 0.5 * 10 ** -decimals(lat) * mPerDeg;
  const dLon = 0.5 * 10 ** -decimals(lon) * mPerDeg * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Size of NASA Goddard's crossover-adjusted 20 m south-pole DEM (PGDA product 90), bytes. */
export const ADJ_BYTES = 2696082051;

/**
 * The main version 2 terrain (D-041): NASA Goddard's crossover-adjusted 20 m south-pole DEM
 * (Barker et al. 2023) backed by the PDS 240 m grid, when the file is complete; otherwise the PDS
 * fine stack. `--pds` on the command line forces the PDS stack (for comparisons).
 */
export async function loadMainStack(): Promise<TerrainStack & { source: 'pgda-adj' | 'pds' }> {
  const pds = loadTerrainStack();
  const { existsSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const path = join(import.meta.dirname, '..', 'data-raw', 'pgda', 'LDEM_80S_20MPP_ADJ.TIF');
  if (process.argv.includes('--pds') || !existsSync(path) || statSync(path).size !== ADJ_BYTES) return { ...pds, source: 'pds' };
  const { loadPgdaDem } = await import('./pgda.ts');
  const adj = await loadPgdaDem('LDEM_80S_20MPP_ADJ.TIF', -80);
  return { ...pds, stack: [adj, pds.v1Far], source: 'pgda-adj' };
}
