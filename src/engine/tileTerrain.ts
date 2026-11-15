// Terrain from browser tiles (terrainTiles.ts) as a TerrainSource for the ray-march: bilinear
// sampling between pixel centres, across tile edges. The caller fetches and decodes the tiles it
// needs (tilesAround) and adds them; a sample that needs a missing tile is NaN, so a nested stack
// falls back to a coarser level there.

import { EXTENT_M, LEVELS, TILE_PX, decodeHeight, tileOf } from './terrainTiles';
import type { Pole, TerrainSource } from './raymarch';

export class TileTerrain implements TerrainSource {
  readonly scaleM: number;
  readonly pole: Pole;
  private readonly tiles = new Map<string, Float32Array>();

  constructor(readonly level: number, pole: Pole = 'south') {
    this.scaleM = LEVELS[level];
    this.pole = pole;
  }

  has(i: number, j: number): boolean {
    return this.tiles.has(`${i}_${j}`);
  }

  /** Adds a tile's heights in metres (TILE_PX * TILE_PX, row-major, NaN = no data). */
  add(i: number, j: number, heights: Float32Array): void {
    if (heights.length !== TILE_PX * TILE_PX) throw new Error('wrong tile size');
    this.tiles.set(`${i}_${j}`, heights);
  }

  /** Tiles at this level that cover the square of half-width radiusM around (x, y). */
  tilesAround(x: number, y: number, radiusM: number): [number, number][] {
    const a = tileOf(this.level, x - radiusM, y + radiusM), b = tileOf(this.level, x + radiusM, y - radiusM);
    const out: [number, number][] = [];
    for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) out.push([i, j]);
    return out;
  }

  private pixel(gx: number, gy: number): number {
    const i = Math.floor(gx / TILE_PX), j = Math.floor(gy / TILE_PX);
    const t = this.tiles.get(`${i}_${j}`);
    return t ? t[(gy - j * TILE_PX) * TILE_PX + (gx - i * TILE_PX)] : NaN;
  }

  sample(x: number, y: number): number {
    const s = this.scaleM;
    // Continuous pixel coordinates with pixel centres at integers.
    const fx = (x + EXTENT_M) / s - 0.5, fy = (EXTENT_M - y) / s - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0) return NaN;
    const dx = fx - x0, dy = fy - y0;
    const top = this.pixel(x0, y0) * (1 - dx) + this.pixel(x0 + 1, y0) * dx;
    const bot = this.pixel(x0, y0 + 1) * (1 - dx) + this.pixel(x0 + 1, y0 + 1) * dx;
    return top * (1 - dy) + bot * dy;
  }
}

/** Heights from a decoded PNG's RGBA pixels (e.g. canvas getImageData). */
export function heightsFromRgba(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(TILE_PX * TILE_PX);
  for (let k = 0; k < out.length; k++) out[k] = decodeHeight(rgba[k * 4], rgba[k * 4 + 1]);
  return out;
}
