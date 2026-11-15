import { describe, expect, it } from 'vitest';
import { EXTENT_M, LEVELS, TILE_PX, decodeHeight, encodeHeight, tileBounds, tileOf, tilesPerSide } from '../src/engine/terrainTiles.ts';

describe('terrain tiles', () => {
  it('round-trips heights in 0.5 m steps and keeps no-data distinct', () => {
    for (const m of [-7296.5, -0.5, 0, 0.5, 1957, 7027]) expect(decodeHeight(...encodeHeight(m))).toBe(m);
    expect(decodeHeight(...encodeHeight(1957.26))).toBe(1957.5);
    expect(Number.isNaN(decodeHeight(...encodeHeight(NaN)))).toBe(true);
  });

  it('puts pixel centres on the LOLA grids\' own pixel centres at 10, 20 and 80 m', () => {
    // LOLA pixel centres: (k - offset) * scale, offsets 15167.5 (10 m), 15199.5 (20 m), 3799.5 (80 m).
    for (const [s, off] of [[10, 15167.5], [20, 15199.5], [80, 3799.5]]) {
      const L = LEVELS.indexOf(s);
      const { x0 } = tileBounds(L, 0, 0);
      const firstCentre = x0 + 0.5 * s;
      const k = firstCentre / s + off; // LOLA column of that centre
      expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-9);
    }
  });

  it('finds the tile and pixel of a point consistently with tileBounds', () => {
    for (let L = 0; L < LEVELS.length; L++) {
      const s = LEVELS[L];
      for (const [x, y] of [[0, 0], [-123456.7, 98765.4], [EXTENT_M - 1, -EXTENT_M + 1]]) {
        const t = tileOf(L, x, y);
        const { x0, y0 } = tileBounds(L, t.i, t.j);
        expect(Math.abs(x0 + (t.c + 0.5) * s - x)).toBeLessThanOrEqual(s / 2);
        expect(Math.abs(y0 - (t.r + 0.5) * s - y)).toBeLessThanOrEqual(s / 2);
        expect(t.i).toBeLessThan(tilesPerSide(L));
        expect(t.c).toBeLessThan(TILE_PX);
      }
    }
  });
});
