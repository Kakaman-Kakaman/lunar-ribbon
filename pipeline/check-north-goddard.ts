// E9 check: long-term Sun and Earth visibility at the north-pole sites (ground level, our north
// terrain) against NASA Goddard's north average-visibility maps (AVGVISIB_85N_060M_201608, PDS
// EXTRAS illumination products; 60 m pixels, value = share of time with any part of the disc
// visible, 0.00004 per unit). Same averaging period as the south comparison (18.6 years from 2020,
// every 2 h), which the maps' own label does not give.
// Run: node pipeline/check-north-goddard.ts      Output: pipeline/out/north-goddard.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`), import.meta.url);
const { horizonProfile, llToXY } = await import('../src/engine/raymarch.ts');
const { FrameCache, computeSeries } = await import('../src/engine/visibility.ts');
const { loadNorthStack } = await import('./terrain-stack.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;

const ROOT = join(import.meta.dirname, '..');
const ILL = join(ROOT, 'data-raw', 'illumination');
function map(name: string) {
  const buf = readFileSync(join(ILL, `${name}.IMG`));
  return { data: new Int16Array(buf.buffer, buf.byteOffset, 5058 * 5058), size: 5058, scaleM: 60, offsetPx: 2528.5, k: 0.00004 };
}
const sunMap = map('AVGVISIB_85N_060M_201608'), earthMap = map('AVGVISIB_85N_060M_201608_EARTH');
const valueAt = (m: ReturnType<typeof map>, x: number, y: number) => {
  const c = Math.round(x / m.scaleM + m.offsetPx), r = Math.round(m.offsetPx - y / m.scaleM);
  return r < 0 || c < 0 || r >= m.size || c >= m.size ? null : m.data[r * m.size + c] * m.k;
};

const { stack } = loadNorthStack();
console.log(`north stack: ${stack.map((g) => g.name).join(' > ')}`);
const index = JSON.parse(readFileSync(join(ROOT, 'public/masks-v2/index.json'), 'utf8')).sites.filter((s: any) => s.lat > 0);
const frames = new FrameCache();
const START = Date.UTC(2020, 0, 1), STEP = 2 * 3600000, N = Math.floor((18.6 * 365.25 * 24) / 2);
const rows: any[] = [];
for (const s of index) {
  const [x, y] = llToXY(s.lat, s.lon, 'north');
  const nasaSun = valueAt(sunMap, x, y), nasaEarth = valueAt(earthMap, x, y);
  if (nasaSun === null) continue;
  const hp = horizonProfile({ lat: s.lat, lon: s.lon, heightsM: [0], near: null, far: null, azStepDeg: 0.5, grids: stack.map((grid) => ({ grid })) });
  const mask: HorizonMask = { id: s.id, name: s.name, lat: s.lat, lon: s.lon, groundElevM: hp.groundElevM, terrain: 'lola-20m', azStepDeg: 0.5, heightsM: [0], horizonDeg: { '0': hp.horizonDeg[0] } };
  const ser = computeSeries(mask, 0, START, STEP, N, frames);
  let sa = 0, ea = 0;
  for (let i = 0; i < N; i++) { if (ser.sunFrac[i] > 0) sa++; if (ser.earthFrac[i] > 0) ea++; }
  rows.push({ id: s.id, lat: s.lat, lon: s.lon, oursSun: sa / N, nasaSun, oursEarth: ea / N, nasaEarth });
  console.log(`${s.id.padEnd(30)} Sun ours ${(100 * sa / N).toFixed(1).padStart(5)}% NASA ${(100 * nasaSun).toFixed(1).padStart(5)}% | Earth ours ${(100 * ea / N).toFixed(1).padStart(5)}% NASA ${(100 * (nasaEarth ?? 0)).toFixed(1).padStart(5)}%`);
}
const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
const corr = (a: number[], b: number[]) => { const ma = mean(a), mb = mean(b); let s = 0, sa = 0, sb = 0; a.forEach((v, i) => { s += (v - ma) * (b[i] - mb); sa += (v - ma) ** 2; sb += (b[i] - mb) ** 2; }); return s / Math.sqrt(sa * sb); };
const med = (a: number[]) => { const t = [...a].sort((p, q) => p - q); return t[t.length >> 1]; };
const sum = (k1: string, k2: string) => ({ n: rows.length, pearson: corr(rows.map((r) => r[k1]), rows.map((r) => r[k2])), medianAbsDiffPp: med(rows.map((r) => 100 * Math.abs(r[k1] - r[k2]))), meanDiffPp: mean(rows.map((r) => 100 * (r[k1] - r[k2]))) });
const out = { generated: new Date().toISOString(), stack: stack.map((g) => g.name), sun: sum('oursSun', 'nasaSun'), earth: sum('oursEarth', 'nasaEarth'), rows };
mkdirSync(join(ROOT, 'pipeline/out'), { recursive: true });
writeFileSync(join(ROOT, 'pipeline/out/north-goddard.json'), JSON.stringify(out, null, 1));
console.log('Sun', JSON.stringify(out.sun), '\nEarth', JSON.stringify(out.earth));
