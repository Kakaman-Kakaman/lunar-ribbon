import { describe, expect, it } from 'vitest';
import { horizonProfile, llToXY, type DemGrid } from '../src/engine/raymarch.ts';
import { LEVELS, TILE_PX, tileBounds } from '../src/engine/terrainTiles.ts';
import { TileTerrain } from '../src/engine/tileTerrain.ts';

const L20 = LEVELS.indexOf(20);
const SITE = { lat: -89.9, lon: 30 };
const [SX, SY] = llToXY(SITE.lat, SITE.lon);

function tilesFrom(f: (x: number, y: number) => number, halfM: number): TileTerrain {
  const t = new TileTerrain(L20);
  for (const [i, j] of t.tilesAround(SX, SY, halfM)) {
    const { x0, y0 } = tileBounds(L20, i, j);
    const h = new Float32Array(TILE_PX * TILE_PX);
    for (let r = 0; r < TILE_PX; r++) for (let c = 0; c < TILE_PX; c++) h[r * TILE_PX + c] = f(x0 + (c + 0.5) * 20, y0 - (r + 0.5) * 20);
    t.add(i, j, h);
  }
  return t;
}

describe('terrain from browser tiles', () => {
  it('samples a sloping plane exactly, across tile edges, and gives NaN where a tile is missing', () => {
    const f = (x: number, y: number) => 0.05 * x - 0.02 * y + 100;
    const t = tilesFrom(f, 8000);
    for (const [dx, dy] of [[0, 0], [1234.5, -987.6], [-4999, 4999], [3333, 17]]) expect(t.sample(SX + dx, SY + dy)).toBeCloseTo(f(SX + dx, SY + dy), 3); // tile heights are Float32
    expect(Number.isNaN(t.sample(SX + 50000, SY))).toBe(true);
  });

  it('gives the same skyline as an in-memory grid with the same pixels', () => {
    // A ridge ring 3 km from the site, 150 m high. The grid's pixel centres match the tiles' (both 10 mod 20 m).
    const ring = (x: number, y: number) => (Math.abs(Math.hypot(x - SX, y - SY) - 3000) < 80 ? 150 : 0);
    const size = 2000;
    const g: DemGrid = { data: new Float32Array(size * size), size, scaleM: 20, dnToM: 1, offsetPx: (size - 1) / 2 };
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) g.data[r * size + c] = ring((c - g.offsetPx) * 20, (g.offsetPx - r) * 20);
    const t = tilesFrom(ring, 6000);
    const flat: DemGrid = { data: new Int16Array(301 * 301), size: 301, scaleM: 1000, dnToM: 1, offsetPx: 150 };
    const opts = { lat: SITE.lat, lon: SITE.lon, heightsM: [2], near: null, far: null, azStepDeg: 2 };
    const a = horizonProfile({ ...opts, grids: [{ grid: g, maxKm: 5 }, { grid: flat }] });
    const b = horizonProfile({ ...opts, grids: [{ grid: t, maxKm: 5 }, { grid: flat }] });
    for (let k = 0; k < a.horizonDeg[0].length; k++) expect(b.horizonDeg[0][k]).toBeCloseTo(a.horizonDeg[0][k], 6);
    expect(Math.min(...b.horizonDeg[0])).toBeGreaterThan(2);
  });
});
