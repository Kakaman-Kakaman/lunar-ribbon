// D-041 check: NASA Goddard's crossover-adjusted 20 m DEM against the PDS 20 m grid at random points
// inside 80 S: height offset, spread, and whether a one-pixel shift fits better (misalignment).
// Run: node pipeline/check-adj.ts
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`), import.meta.url);
const { loadLola } = await import('./lola.ts');
const { loadPgdaDem } = await import('./pgda.ts');
const pds = loadLola('LDEM_80S_20M');
const adj = await loadPgdaDem('LDEM_80S_20MPP_ADJ.TIF', -80);
if (adj.size !== pds.size || adj.offsetPx !== pds.offsetPx) console.log(`grid geometry differs: adj ${adj.size}/${adj.offsetPx}, pds ${pds.size}/${pds.offsetPx}`);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pts: [number, number][] = [];
while (pts.length < 20000) {
  const r = Math.floor(rnd() * pds.size), c = Math.floor(rnd() * pds.size);
  const x = c - pds.offsetPx, y = pds.offsetPx - r;
  if (Math.hypot(x, y) * 20 > 300000) continue; // inside about 80.1 S
  pts.push([r, c]);
}
const med = (a: number[]) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; };
for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
  const d: number[] = [];
  for (const [r, c] of pts) {
    const a = adj.data[(r + dr) * adj.size + (c + dc)];
    const b = pds.data[r * pds.size + c] * pds.dnToM;
    if (Number.isFinite(a) && !Number.isNaN(a)) d.push(a - b);
  }
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  const rms = Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
  const abs = d.map(Math.abs);
  console.log(`shift (${dr},${dc}) px: n ${d.length}, mean ${mean.toFixed(2)} m, median ${med(d).toFixed(2)} m, RMS ${rms.toFixed(2)} m, 95th pct |diff| ${[...abs].sort((p, q) => p - q)[Math.floor(abs.length * 0.95)].toFixed(2)} m`);
}
