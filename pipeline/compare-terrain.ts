// E1 check (docs/PLAN-V2.md): the version 1 terrain recipe against nested full-resolution terrain,
// both compared with NASA Goddard's average-visibility maps at the 23 masked sites and with the
// Barker et al. (2021) connecting-ridge benchmark.
// Run: node pipeline/compare-terrain.ts [--with-5m]      Output: pipeline/out/terrain-v2-comparison.json
// NASA values come from the cached Moon Trek replies in tests/fixtures/trek/comparison.json, so no
// network is needed. Grids that are missing or still downloading are skipped and listed.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`),
  import.meta.url,
);

const { FrameCache, computeSeries } = await import('../src/engine/visibility.ts');
const { horizonProfile, sampleDem, llToXY } = await import('../src/engine/raymarch.ts');
const { loadTerrainStack, loadMainStack } = await import('./terrain-stack.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;

const ROOT = join(import.meta.dirname, '..');
const HOUR = 3600000;

// ---- Terrain ----
// `--with-5m` adds the PDS 5 m grid to the nested stack, for comparison only (D-042).
// Main v2 terrain (D-041: the 2023 adjusted 20 m DEM when present); --with-5m adds the PDS 5 m grid for comparison (D-042).
const main = process.argv.includes('--with-5m') ? { ...loadTerrainStack([]), source: 'pds-with-5m' } : await loadMainStack();
const { v1Near, v1Far, stack, skipped } = main;
console.log(`terrain: ${main.source}`);
console.log(`nested stack: ${stack.map((g) => g.name).join(' > ')}`);
if (skipped.length) console.log(`skipped: ${skipped.join('; ')}`);

const AZ_V2 = 0.1;
const HEIGHTS = [0, 1, 2, 5, 10];
const round2 = (v: number) => Math.round(v * 100) / 100;

function maskFrom(site: { id: string; name: string; lat: number; lon: number }, hs: number[], hp: ReturnType<typeof horizonProfile>, az: number, terrain: HorizonMask['terrain']): HorizonMask {
  const horizonDeg: Record<string, number[]> = {};
  hs.forEach((h, i) => (horizonDeg[String(h)] = hp.horizonDeg[i].map(round2)));
  return { id: site.id, name: site.name, lat: site.lat, lon: site.lon, groundElevM: hp.groundElevM, terrain, azStepDeg: az, heightsM: hs, horizonDeg };
}

// ---- Averages, the same definitions as pipeline/validate-illumination.ts ----
const frames = new FrameCache();
function averages(mask: HorizonMask, h: number, startMs: number, stepMs: number, n: number) {
  const s = computeSeries(mask, h, startMs, stepMs, n, frames);
  let sm = 0, sa = 0, em = 0, ea = 0;
  for (let i = 0; i < n; i++) {
    sm += s.sunFrac[i]; if (s.sunFrac[i] > 0) sa++;
    em += s.earthFrac[i]; if (s.earthFrac[i] > 0) ea++;
  }
  return { sunMean: sm / n, sunAny: sa / n, earthMean: em / n, earthAny: ea / n };
}
const START = Date.UTC(2020, 0, 1), STEP = 2 * HOUR, N = Math.floor((18.6 * 365.25 * 24) / 2);
const B_START = Date.UTC(2024, 0, 1), B_N = Math.round((Date.UTC(2026, 0, 1) - B_START) / HOUR);

// ---- Sites and NASA values ----
const cmp = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/trek/comparison.json'), 'utf8'));
const rows: any[] = [];
for (const s of cmp.sites) {
  const t0 = Date.now();
  const v1hp = horizonProfile({ lat: s.lat, lon: s.lon, heightsM: [0], near: v1Near, far: v1Far, azStepDeg: 0.5 });
  const t1 = Date.now();
  const v2hp = horizonProfile({ lat: s.lat, lon: s.lon, heightsM: HEIGHTS, near: null, far: null, azStepDeg: AZ_V2, grids: stack.map((grid) => ({ grid })) });
  const t2 = Date.now();
  const v1 = maskFrom(s, [0], v1hp, 0.5, 'lola-80m+240m');
  const v2 = maskFrom(s, HEIGHTS, v2hp, AZ_V2, 'lola-80m+240m');
  const [sx, sy] = llToXY(s.lat, s.lon);
  const finest = stack.find((g) => !Number.isNaN(sampleDem(g, sx, sy)))?.name ?? 'none';
  // Skyline change at ground level, on the version 1 azimuths (every 0.5 degrees = every 5th v2 entry).
  const d = v1hp.horizonDeg[0].map((v, i) => v2hp.horizonDeg[0][i * 5] - v);
  const row: any = {
    id: s.id, group: s.group, lat: s.lat, lon: s.lon, finestGridAtSite: finest,
    groundM: { v1: round2(v1hp.groundElevM), v2: round2(v2hp.groundElevM), trek30m: s.trekDem30mM },
    skylineDiffDeg: { mean: round2(d.reduce((a, b) => a + b, 0) / d.length), maxUp: round2(Math.max(...d)), maxDown: round2(Math.min(...d)) },
    nasa: { sun: s.nasa.sun?.value ?? null, earth: s.nasa.earth?.value ?? null },
    v1: { h0: averages(v1, 0, START, STEP, N) },
    v2: Object.fromEntries(HEIGHTS.map((h) => [`h${h}`, averages(v2, h, START, STEP, N)])),
    ms: { v1: t1 - t0, v2: t2 - t1 },
  };
  if (s.id.startsWith('pgda-site01-connecting-ridge')) {
    row.barker = { v2: Object.fromEntries([1, 2, 5, 10].map((h) => [`h${h}`, averages(v2, h, B_START, HOUR, B_N).sunMean])) };
  }
  rows.push(row);
  const pct = (v: number) => (100 * v).toFixed(1);
  console.log(`${s.id.padEnd(42)} NASA sun ${row.nasa.sun === null ? '  -  ' : pct(row.nasa.sun).padStart(5)} | v1 ${pct(row.v1.h0.sunAny).padStart(5)} | v2 ${pct(row.v2.h0.sunAny).padStart(5)} | skyline ${row.skylineDiffDeg.mean >= 0 ? '+' : ''}${row.skylineDiffDeg.mean} deg | ${finest} | ${row.ms.v2} ms`);
}

// ---- Statistics ----
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function pearson(a: number[], b: number[]) {
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}
function stats(body: 'sun' | 'earth', pick: (r: any) => number, filter: (r: any) => boolean = () => true) {
  const rs = rows.filter((r) => r.nasa[body] !== null && filter(r));
  const ours = rs.map(pick), nasa = rs.map((r) => r.nasa[body]);
  const diff = ours.map((v, i) => 100 * (v - nasa[i]));
  let w = 0;
  for (let i = 1; i < diff.length; i++) if (Math.abs(diff[i]) > Math.abs(diff[w])) w = i;
  return { n: rs.length, pearson: round2(pearson(ours, nasa) * 1000) / 1000, medianAbsDiffPp: round2(median(diff.map(Math.abs))), meanDiffPp: round2(mean(diff)), worst: rs.length ? `${rs[w].id} ${round2(diff[w])}` : null };
}
const crest = (r: any) => r.id.endsWith('-crest');
const summary = {
  sun: { v1: stats('sun', (r) => r.v1.h0.sunAny), v2: stats('sun', (r) => r.v2.h0.sunAny) },
  sunCrests: { v1: stats('sun', (r) => r.v1.h0.sunAny, crest), v2: stats('sun', (r) => r.v2.h0.sunAny, crest) },
  sunListed: { v1: stats('sun', (r) => r.v1.h0.sunAny, (r) => !crest(r)), v2: stats('sun', (r) => r.v2.h0.sunAny, (r) => !crest(r)) },
  earth: { v1: stats('earth', (r) => r.v1.h0.earthAny), v2: stats('earth', (r) => r.v2.h0.earthAny) },
};
const barker = rows.filter((r) => r.barker).map((r) => ({ id: r.id, ...r.barker.v2 }));

mkdirSync(join(ROOT, 'pipeline/out'), { recursive: true });
writeFileSync(join(ROOT, 'pipeline/out/terrain-v2-comparison.json'), JSON.stringify({
  generated: new Date().toISOString(), stack: stack.map((g) => g.name), skipped, azStepDeg: { v1: 0.5, v2: AZ_V2 },
  period: cmp.period, barkerPeriod: '2024-01-01 to 2026-01-01, hourly; Barker et al. (2021) Table 2: best regions about 67-71% at 1 m and 83-89% at 5 m',
  summary, barker, rows,
}, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('Barker benchmark, mean Sun disc fraction (v2):', JSON.stringify(barker));
