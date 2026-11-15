// Terrain tiles for the browser (docs/PLAN-V2.md E1, data budget section 6).
//
// The south polar stereographic plane (the projection of every LOLA grid, see raymarch.ts) is cut
// into square tiles of TILE_PX x TILE_PX pixels per level; level L has pixel size LEVELS[L] metres.
// Tile (L, i, j) starts at x = -EXTENT_M + i * TILE_PX * s and y = EXTENT_M - j * TILE_PX * s
// (tileBounds), so pixel centres fall on the LOLA grids' own pixel centres at 10, 20 and 80 m.
// Only tiles near sites exist at the fine levels; tiles/index.json lists them. Heights are in PNG RGB:
// value = R * 256 + G is (height in metres + HEIGHT_OFFSET_M) * 2, i.e. 0.5 m steps; value 0 means
// no data. B is unused (0).

export const TILE_PX = 256;
/** Pixel size of each level, metres, coarsest first. */
export const LEVELS = [640, 160, 80, 40, 20, 10];
/** Half-width of the tiled square, metres (80 S on the 1737.4 km sphere is about 303.4 km from the pole). */
export const EXTENT_M = 307200;
export const HEIGHT_OFFSET_M = 10000;

export interface TileBounds {
  /** Left and top edges of the tile, projected metres; pixel (c, r) centre is at x0 + (c + 0.5) * s, y0 - (r + 0.5) * s. */
  x0: number;
  y0: number;
  scaleM: number;
}

export function tileBounds(level: number, i: number, j: number): TileBounds {
  const s = LEVELS[level];
  return { x0: -EXTENT_M + i * TILE_PX * s, y0: EXTENT_M - j * TILE_PX * s, scaleM: s };
}

/** Tiles per side at a level. */
export const tilesPerSide = (level: number) => Math.ceil((2 * EXTENT_M) / (TILE_PX * LEVELS[level]));

/** The tile and pixel holding projected point (x, y) at a level. */
export function tileOf(level: number, x: number, y: number): { i: number; j: number; c: number; r: number } {
  const s = LEVELS[level];
  const gx = (x + EXTENT_M) / s, gy = (EXTENT_M - y) / s;
  const i = Math.floor(gx / TILE_PX), j = Math.floor(gy / TILE_PX);
  return { i, j, c: Math.floor(gx - i * TILE_PX), r: Math.floor(gy - j * TILE_PX) };
}

export const tilePath = (level: number, i: number, j: number) => `${LEVELS[level]}m/${i}_${j}.png`;

export function encodeHeight(m: number): [number, number] {
  if (!Number.isFinite(m)) return [0, 0];
  const v = Math.max(1, Math.min(65535, Math.round((m + HEIGHT_OFFSET_M) * 2)));
  return [v >> 8, v & 255];
}

export function decodeHeight(r: number, g: number): number {
  const v = r * 256 + g;
  return v === 0 ? NaN : v / 2 - HEIGHT_OFFSET_M;
}
