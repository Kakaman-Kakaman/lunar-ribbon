// Browser terrain tiles (src/engine/terrainTiles.ts). Whole region at 640, 160 and 80 m; finer
// levels only near sites, to stay inside GitHub Pages' 1 GB limit (PLAN-V2 section 6):
// 40 m within 40 km, 20 m within 15 km, 10 m within 8 km (inside the 10 m grid's coverage).
// Levels at a grid's own pixel size copy pixels (tile pixel centres match the grid's); coarser levels
// are block averages. Afterwards a sample of tiles is decoded and compared with the source grid.
// Run: node pipeline/build-tiles.ts      Output: public/tiles/<scale>m/<i>_<j>.png and index.json

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`),
  import.meta.url,
);

const { llToXY } = await import('../src/engine/raymarch.ts');
const T = await import('../src/engine/terrainTiles.ts');
const { encodePngRgb } = await import('./png.ts');
const { loadTerrainStack } = await import('./terrain-stack.ts');
type DemGrid = import('../src/engine/raymarch.ts').DemGrid;

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'tiles');
const { v1Near, stack } = loadTerrainStack();
const g10 = stack.find((g) => g.scaleM === 10);
const g20 = stack.find((g) => g.scaleM === 20);
if (!g20) throw new Error('need a 20 m grid');
console.log(`sources: 80 m ${v1Near.name}, 20 m ${g20.name}, 10 m ${g10?.name ?? 'none'}`);

/** Height in metres of native pixel (col, row) of a grid, NaN outside or no data. */
function pix(g: DemGrid, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= g.size || row >= g.size) return NaN;
  const v = g.data[row * g.size + col];
  return Number.isNaN(v) ? NaN : v * g.dnToM;
}
/** Mean height over the square of size s (m) centred at (x, y), from grid g's native pixels. */
function boxMean(g: DemGrid, x: number, y: number, s: number): number {
  const k = Math.round(s / g.scaleM);
  const c0 = Math.round((x - s / 2) / g.scaleM + g.offsetPx + 0.5);
  const r0 = Math.round(g.offsetPx - (y + s / 2) / g.scaleM + 0.5);
  let sum = 0, n = 0;
  for (let dr = 0; dr < k; dr++) for (let dc = 0; dc < k; dc++) {
    const v = pix(g, c0 + dc, r0 + dr);
    if (!Number.isNaN(v)) { sum += v; n++; }
  }
  return n ? sum / n : NaN;
}

const sites = (JSON.parse(readFileSync(join(ROOT, 'public/masks/index.json'), 'utf8')) as { id: string; lat: number; lon: number }[])
  .filter((s) => s.lat <= -80)
  .map((s) => { const [x, y] = llToXY(s.lat, s.lon); return { id: s.id, x, y }; });

// level index -> [source grid, radius around sites in m (Infinity = everywhere)]
const PLAN: Record<number, [DemGrid | undefined, number]> = {
  640: [v1Near, Infinity], 160: [v1Near, Infinity], 80: [v1Near, Infinity],
  40: [g20, 40000], 20: [g20, 15000], 10: [g10, 8000],
};

rmSync(OUT, { recursive: true, force: true });
const index: { scaleM: number; tiles: string[] }[] = [];
let totalBytes = 0;
const t0 = Date.now();
for (let L = 0; L < T.LEVELS.length; L++) {
  const s = T.LEVELS[L];
  const [src, radius] = PLAN[s];
  const tiles: string[] = [];
  index.push({ scaleM: s, tiles });
  if (!src) continue;
  mkdirSync(join(OUT, `${s}m`), { recursive: true });
  const n = T.tilesPerSide(L), span = T.TILE_PX * s;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const { x0, y0 } = T.tileBounds(L, i, j);
    if (radius !== Infinity) {
      const near = sites.some((p) => Math.hypot(Math.max(x0 - p.x, 0, p.x - (x0 + span)), Math.max(p.y - y0, 0, y0 - span - p.y)) <= radius);
      if (!near) continue;
    }
    const rgb = new Uint8Array(T.TILE_PX * T.TILE_PX * 3);
    let any = false;
    for (let r = 0; r < T.TILE_PX; r++) for (let c = 0; c < T.TILE_PX; c++) {
      const x = x0 + (c + 0.5) * s, y = y0 - (r + 0.5) * s;
      const h = s === src.scaleM
        ? pix(src, Math.round(x / s + src.offsetPx), Math.round(src.offsetPx - y / s))
        : boxMean(src, x, y, s);
      if (!Number.isNaN(h)) any = true;
      const [hi, lo] = T.encodeHeight(h);
      const o = (r * T.TILE_PX + c) * 3;
      rgb[o] = hi; rgb[o + 1] = lo;
    }
    if (!any) continue;
    const png = encodePngRgb(T.TILE_PX, T.TILE_PX, rgb);
    writeFileSync(join(OUT, T.tilePath(L, i, j)), png);
    totalBytes += png.length;
    tiles.push(`${i}_${j}`);
  }
  console.log(`${String(s).padStart(4)} m: ${tiles.length} tiles, running total ${(totalBytes / 1048576).toFixed(0)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({
  tilePx: T.TILE_PX, extentM: T.EXTENT_M, heightOffsetM: T.HEIGHT_OFFSET_M,
  sources: { '640': `${v1Near.name} (mean)`, '160': `${v1Near.name} (mean)`, '80': v1Near.name, '40': `${g20.name} (mean)`, '20': g20.name, '10': g10?.name ?? null },
  levels: index,
}) + '\n');

// ---- Check: decode a sample of tiles and compare with the source grid ----
function decodePng(path: string): Uint8Array {
  const b = readFileSync(path);
  let p = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('ascii', p + 4, p + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); }
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 3, out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < stride; x++) out[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + (x >= 3 ? out[y * stride + x - 3] : 0)) & 255;
  return out;
}
let worst = 0, checked = 0;
for (const lv of index) {
  const L = T.LEVELS.indexOf(lv.scaleM), [src] = PLAN[lv.scaleM];
  if (!src || src.scaleM !== lv.scaleM) continue; // only native levels compare pixel for pixel
  for (const key of lv.tiles.filter((_, k) => k % Math.max(1, Math.floor(lv.tiles.length / 10)) === 0)) {
    const [i, j] = key.split('_').map(Number);
    const rgb = decodePng(join(OUT, T.tilePath(L, i, j)));
    const { x0, y0 } = T.tileBounds(L, i, j);
    for (let k = 0; k < 500; k++) {
      const c = (k * 37) % T.TILE_PX, r = (k * 101) % T.TILE_PX;
      const x = x0 + (c + 0.5) * lv.scaleM, y = y0 - (r + 0.5) * lv.scaleM;
      const want = pix(src, Math.round(x / lv.scaleM + src.offsetPx), Math.round(src.offsetPx - y / lv.scaleM));
      const got = T.decodeHeight(rgb[(r * T.TILE_PX + c) * 3], rgb[(r * T.TILE_PX + c) * 3 + 1]);
      if (Number.isNaN(want) !== Number.isNaN(got)) throw new Error(`no-data mismatch at ${lv.scaleM} m ${key} (${c},${r})`);
      if (!Number.isNaN(want)) { worst = Math.max(worst, Math.abs(want - got)); checked++; }
    }
  }
}
console.log(`check: ${checked} pixels decoded from native-level tiles, largest difference from the source grid ${worst} m (0.5 m steps)`);
console.log(`total ${(totalBytes / 1048576).toFixed(0)} MB in ${index.reduce((a, l) => a + l.tiles.length, 0)} tiles`);
