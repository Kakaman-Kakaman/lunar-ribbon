// Browser side of the terrain tiles (engine/terrainTiles.ts): which tiles exist, fetching and
// decoding them, and assembling a TileTerrain for an area.

import { LEVELS } from '../engine/terrainTiles';
import type { Pole } from '../engine/raymarch';
import { TileTerrain, heightsFromRgba } from '../engine/tileTerrain';

const base = () => import.meta.env.BASE_URL;

interface TileIndex {
  levels: { scaleM: number; tiles: string[] }[];
}

/** South-pole tiles live in tiles/, north-pole tiles in tiles-north/. */
const dirOf = (pole: Pole) => (pole === 'north' ? 'tiles-north' : 'tiles');
const indexP = new Map<Pole, Promise<TileIndex | null>>();
function tileIndex(pole: Pole): Promise<TileIndex | null> {
  let p = indexP.get(pole);
  if (!p) {
    p = fetch(`${base()}${dirOf(pole)}/index.json`).then((r) => (r.ok ? (r.json() as Promise<TileIndex>) : null)).catch(() => null);
    indexP.set(pole, p);
  }
  return p;
}

const tileCache = new Map<string, Promise<Float32Array | null>>();

function decode(url: string): Promise<Float32Array | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      resolve(heightsFromRgba(g.getImageData(0, 0, img.width, img.height).data));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Terrain at one level (pixel size scaleM) covering the square of half-width radiusM around projected
 * point (x, y): only tiles that exist are fetched; elsewhere the terrain is NaN. Resolves to null if
 * the tile set has no tiles at that level.
 */
export async function loadTerrain(scaleM: number, x: number, y: number, radiusM: number, pole: Pole = 'south'): Promise<TileTerrain | null> {
  const idx = await tileIndex(pole);
  const L = LEVELS.indexOf(scaleM);
  const lv = idx?.levels.find((l) => l.scaleM === scaleM);
  if (!idx || L < 0 || !lv || !lv.tiles.length) return null;
  const have = new Set(lv.tiles);
  const t = new TileTerrain(L, pole);
  const wanted = t.tilesAround(x, y, radiusM).filter(([i, j]) => have.has(`${i}_${j}`));
  if (!wanted.length) return null;
  await Promise.all(wanted.map(async ([i, j]) => {
    const key = `${pole}/${scaleM}/${i}_${j}`;
    let p = tileCache.get(key);
    if (!p) {
      p = decode(`${base()}${dirOf(pole)}/${scaleM}m/${i}_${j}.png`);
      tileCache.set(key, p);
    }
    const h = await p;
    if (h) t.add(i, j, h);
  }));
  return t;
}
