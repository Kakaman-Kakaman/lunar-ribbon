// E8: lattice skylines for sunlight and Earth-view maps (src/engine/areaMap.ts), around each site with
// real terrain inside 80 S. Uses worker threads on terrain held once in shared memory.
// Run: node pipeline/build-area-maps.ts [--site <id>] [--n 100] [--spacing 200] [--workers 10]
// Output: public/area/<id>_<height>m.json and public/area/index.json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { register } from 'node:module';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

const HOOK = 'data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`);
register(HOOK, import.meta.url);

const { llToXY } = await import('../src/engine/raymarch.ts');
const { pointXY, packBytes } = await import('../src/engine/areaMap.ts');
const { packInt16 } = await import('../src/engine/maskV2.ts');
const { loadTerrainStack, loadMainStack } = await import('./terrain-stack.ts');

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('n', '100')), SPACING = Number(arg('spacing', '200')), WORKERS = Number(arg('workers', String(Math.max(1, cpus().length - 2))));
const ONLY = arg('site', '');
const HEIGHTS = [2, 10];
const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'area');

const { stack, source: terrainSource } = await loadMainStack();
console.log(`terrain: ${terrainSource}`);
const terrain = stack.map((g) => g.name);
const shared = stack.map((g) => {
  const sab = new SharedArrayBuffer(g.data.byteLength);
  (g.data instanceof Float32Array ? new Float32Array(sab) : new Int16Array(sab)).set(g.data as any);
  return { sab, float: g.data instanceof Float32Array, size: g.size, scaleM: g.scaleM, dnToM: g.dnToM, offsetPx: g.offsetPx };
});
console.log(`terrain ${terrain.join(' > ')} in shared memory; ${WORKERS} workers; lattice ${N} x ${N} at ${SPACING} m`);

const workerUrl = new URL('./area-worker.ts', import.meta.url);
const pool = Array.from({ length: WORKERS }, () => new Worker(workerUrl, { workerData: { grids: shared, heights: HEIGHTS } }));

async function runRegion(cx: number, cy: number) {
  const pts: [number, number][] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push(pointXY({ cx, cy, spacingM: SPACING, n: N }, i, j));
  const BATCH = 50;
  const ground = new Int16Array(pts.length);
  const sky = HEIGHTS.map(() => new Uint8Array(pts.length * 360));
  let next = 0, done = 0;
  await new Promise<void>((resolve) => {
    const feed = (w: Worker) => {
      if (next >= pts.length) return;
      const id = next;
      next += BATCH;
      w.postMessage({ id, xy: pts.slice(id, id + BATCH) });
    };
    for (const w of pool) {
      w.removeAllListeners('message');
      w.on('message', (m: { id: number; ground: Int16Array; sky: Uint8Array[] }) => {
        ground.set(m.ground, m.id);
        m.sky.forEach((s, hi) => sky[hi].set(s, m.id * 360));
        done += m.ground.length;
        if (done >= pts.length) resolve(); else feed(w);
      });
      feed(w);
    }
  });
  return { ground, sky };
}

const sites = (JSON.parse(readFileSync(join(ROOT, 'public/masks/index.json'), 'utf8')) as { id: string; lat: number; lon: number }[])
  .filter((s) => s.lat <= -80 && (!ONLY || s.id === ONLY));
mkdirSync(OUT, { recursive: true });
const index: any[] = [];
for (const s of sites) {
  const t0 = Date.now();
  const [cx, cy] = llToXY(s.lat, s.lon);
  const { ground, sky } = await runRegion(cx, cy);
  HEIGHTS.forEach((h, hi) => {
    const g = { id: s.id, cx, cy, spacingM: SPACING, n: N, heightM: h, terrain, ground: packInt16(ground), skyline: packBytes(sky[hi]) };
    writeFileSync(join(OUT, `${s.id}_${h}m.json`), JSON.stringify(g));
  });
  index.push({ id: s.id, cx, cy, spacingM: SPACING, n: N, heightsM: HEIGHTS });
  console.log(`${s.id.padEnd(42)} ${N * N} points in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ terrain, regions: index }, null, 1) + '\n');
for (const w of pool) await w.terminate();
