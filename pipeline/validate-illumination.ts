// Validation of the skyline masks and the visibility engine against NASA Goddard's average Sun and
// Earth visibility maps (served by NASA Moon Trek), plus the Barker et al. (2021) benchmark.
// Run: node pipeline/validate-illumination.ts   (network only for uncached Moon Trek requests)
// Output: tests/fixtures/trek/comparison.json (read by pipeline/build-validation.ts)
//
// The engine files import each other without the .ts extension, which plain Node cannot resolve,
// so this script registers a tiny resolve hook (in this file only; the engine is not edited).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const { llToXY, horizonProfile } = await import('../src/engine/raymarch.ts');
type DemGrid = import('../src/engine/raymarch.ts').DemGrid;
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;

const ROOT = join(import.meta.dirname, '..');
const FIX = join(ROOT, 'tests', 'fixtures', 'trek');
mkdirSync(FIX, { recursive: true });

// LOLA grids loaded exactly as pipeline/build-masks.ts does (raw files are git-ignored).
function loadImg(path: string): Int16Array {
  const buf = readFileSync(path);
  return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}
const NEAR: DemGrid = { data: loadImg(join(ROOT, 'data-raw/lola/LDEM_80S_80M.IMG')), size: 7600, scaleM: 80, dnToM: 0.5, offsetPx: 3799.5 };
const FAR: DemGrid = { data: loadImg(join(ROOT, 'data-raw/lola/LDEM_60S_240M.IMG')), size: 7760, scaleM: 240, dnToM: 0.5, offsetPx: 3879.5 };
const round2 = (v: number) => Math.round(v * 100) / 100;

const BASE = 'https://trek.nasa.gov/moon/trekarcgis2/rest/services';
const HOUR = 3600000;

// Finest map first. Names are from the Moon Trek service listing (research note 04, section 4b).
const SUN_SERVICES = ['AVGVISIB_85S_060M_201608_SP', 'AVGVISIB_75S_120M_201608_SP', 'AVGVISIB_65S_240M_201608_SP'];
const EARTH_SERVICES = SUN_SERVICES.map((s) => s.replace('_SP', '_EARTH_SP'));
const DEM_SERVICE = 'LRO_LOLA_DEM_SPole75_30mp_v04_SP';

// ---- Moon Trek access with an on-disk cache and at most one network request per second ----
let lastRequest = 0;
async function cachedGet(file: string, url: string): Promise<any> {
  const path = join(FIX, file);
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const wait = lastRequest + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = JSON.parse(text);
  writeFileSync(path, JSON.stringify({ url, fetched: new Date().toISOString(), reply: json }, null, 1));
  return JSON.parse(readFileSync(path, 'utf8'));
}

interface Meta { xmin: number; xmax: number; ymin: number; ymax: number; pixel: number }
const metas: Record<string, Meta> = {};
async function metaOf(service: string): Promise<Meta> {
  if (metas[service]) return metas[service];
  const r = (await cachedGet(`meta__${service}.json`, `${BASE}/${service}/ImageServer?f=json`)).reply;
  metas[service] = { xmin: r.extent.xmin, xmax: r.extent.xmax, ymin: r.extent.ymin, ymax: r.extent.ymax, pixel: r.pixelSizeX };
  console.log(`meta ${service}: pixel ${r.pixelSizeX} m, type ${r.pixelType}, extent +/-${r.extent.xmax} m`);
  return metas[service];
}

/** Pixel value at (x, y), or null if outside the extent or "NoData". */
async function identify(service: string, id: string, x: number, y: number): Promise<number | null> {
  const m = await metaOf(service);
  if (x < m.xmin || x > m.xmax || y < m.ymin || y > m.ymax) return null;
  const geom = encodeURIComponent(JSON.stringify({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }));
  const url = `${BASE}/${service}/ImageServer/identify?geometry=${geom}&geometryType=esriGeometryPoint&returnGeometry=false&returnCatalogItems=false&f=json`;
  const r = (await cachedGet(`identify__${service}__${id}.json`, url)).reply;
  const v = Number(r.value);
  return r.value === 'NoData' || !Number.isFinite(v) ? null : v;
}

// ---- Statistics ----
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
function pearson(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}
function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
  const r = new Array<number>(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));
function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---- Our averages ----
const masks: HorizonMask[] = readdirSync(join(ROOT, 'public', 'masks'))
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'public', 'masks', f), 'utf8')));

// The NASA maps average hourly steps over a full lunar nutation cycle of about 18.6 years (research
// note 04, 2a). The note gives no calendar dates, so we use 18.6 years from 2020-01-01, every 2 hours.
const START = Date.UTC(2020, 0, 1);
const STEP = 2 * HOUR;
const N = Math.floor((18.6 * 365.25 * 24) / 2);
const frames = new FrameCache();

function averages(mask: HorizonMask, h: number, startMs: number, stepMs: number, n: number) {
  const s = computeSeries(mask, h, startMs, stepMs, n, frames);
  let sm = 0, sa = 0, su = 0, em = 0, ea = 0, eu = 0;
  for (let i = 0; i < n; i++) {
    sm += s.sunFrac[i]; if (s.sunFrac[i] > 0) sa++; if (s.sunFrac[i] >= 0.5) su++;
    em += s.earthFrac[i]; if (s.earthFrac[i] > 0) ea++; if (s.earthFrac[i] >= 0.5) eu++;
  }
  return { sunMean: sm / n, sunAny: sa / n, sunUp: su / n, earthMean: em / n, earthAny: ea / n, earthUp: eu / n };
}

const SERIES = { sun: SUN_SERVICES, earth: EARTH_SERVICES };
const sites: any[] = [];
for (const m of masks) {
  const [x, y] = llToXY(m.lat, m.lon);
  const nasa: any = {};
  for (const body of ['sun', 'earth'] as const) {
    nasa[body] = null;
    for (const svc of SERIES[body]) {
      const v = await identify(svc, m.id, x, y);
      if (v !== null) { nasa[body] = { service: svc, pixelM: metas[svc].pixel, value: v }; break; }
    }
  }
  const dem = await identify(DEM_SERVICE, m.id, x, y);
  const ours: any = {};
  for (const h of m.heightsM) ours[`h${h}`] = averages(m, h, START, STEP, N);
  // Ground level (0 m): skyline computed directly from the DEMs, same recipe as build-masks.ts.
  // The shipped masks are not changed; 2 m is recomputed here only as a consistency check.
  const hp = horizonProfile({ lat: m.lat, lon: m.lon, heightsM: [0, 2], near: NEAR, far: FAR, azStepDeg: 0.5 });
  const m0: HorizonMask = { ...m, heightsM: [0, 2], horizonDeg: { '0': hp.horizonDeg[0].map(round2), '2': hp.horizonDeg[1].map(round2) } };
  ours.h0 = averages(m0, 0, START, STEP, N);
  const re2 = averages(m0, 2, START, STEP, N);
  ours.h0check = { skylineMaxDiffDeg: Math.max(...m.horizonDeg['2'].map((v, i) => Math.abs(v - m0.horizonDeg['2'][i]))), sunAny2mRecomputed: re2.sunAny };
  sites.push({
    // mask files carry `group`; the engine's HorizonMask type does not declare it
    id: m.id, name: m.name, group: (m as { group?: string }).group, lat: m.lat, lon: m.lon, terrain: m.terrain,
    xM: x, yM: y, groundElevM: m.groundElevM, trekDem30mM: dem, ours, nasa,
  });
  console.log(`${m.id}: NASA sun ${nasa.sun?.value ?? 'NoData'} earth ${nasa.earth?.value ?? 'NoData'}; ours(2m) sun ${ours.h2.sunAny.toFixed(3)} earth ${ours.h2.earthAny.toFixed(3)}; DEM ${dem} vs ${m.groundElevM}`);
}

// ---- Comparison statistics (like-for-like: NASA counts a body as visible if any part of its disc is) ----
function stats(body: 'sun' | 'earth', h: number, metric: 'Any' | 'Mean' | 'Up') {
  const rows = sites.filter((s) => s.nasa[body]);
  const ours = rows.map((s) => s.ours[`h${h}`][`${body}${metric}`] as number);
  const nasa = rows.map((s) => s.nasa[body].value as number);
  const diff = ours.map((v, i) => 100 * (v - nasa[i]));
  let worst = 0;
  for (let i = 1; i < diff.length; i++) if (Math.abs(diff[i]) > Math.abs(diff[worst])) worst = i;
  return {
    n: rows.length,
    pearson: pearson(ours, nasa),
    spearman: spearman(ours, nasa),
    medianAbsDiffPp: median(diff.map(Math.abs)),
    meanDiffPp: mean(diff),
    sitesOver30pp: rows.filter((_, i) => Math.abs(diff[i]) > 30).map((s) => s.id),
    worstSite: rows[worst].id,
    worstDiffPp: diff[worst],
  };
}
const comparison: any = {};
for (const body of ['sun', 'earth'] as const)
  for (const h of [0, 2, 10])
    for (const metric of ['Any', 'Mean', 'Up'] as const) comparison[`${body}_h${h}_${metric}`] = stats(body, h, metric);

// Orientation check: ground height at each site from our masks against Moon Trek's 30 m DEM.
const demRows = sites.filter((s) => s.trekDem30mM !== null && s.groundElevM !== null);
const demDiff = demRows.map((s) => s.groundElevM - s.trekDem30mM);

// ---- Task 2: Barker et al. (2021) benchmark, 2024-01-01 to 2026-01-01, hourly ----
const B_START = Date.UTC(2024, 0, 1);
const B_N = Math.round((Date.UTC(2026, 0, 1) - B_START) / HOUR);
const benchmark: any = {};
for (const id of ['pgda-site01-connecting-ridge-crest', 'pgda-site01-connecting-ridge']) {
  const m = masks.find((k) => k.id === id)!;
  benchmark[id] = {
    h2: averages(m, 2, B_START, HOUR, B_N),
    h10: averages(m, 10, B_START, HOUR, B_N),
  };
}

const out = {
  generated: new Date().toISOString(),
  period: {
    start: new Date(START).toISOString(), stepHours: 2, samples: N,
    end: new Date(START + (N - 1) * STEP).toISOString(),
    note: 'Research note 04 section 2a gives 18.6 years (hourly steps) without calendar dates; we use 18.6 years from 2020-01-01 every 2 hours.',
  },
  services: { sun: SUN_SERVICES, earth: EARTH_SERVICES, dem: DEM_SERVICE },
  sites,
  comparison,
  demCheck: { n: demRows.length, medianAbsDiffM: median(demDiff.map(Math.abs)), maxAbsDiffM: Math.max(...demDiff.map(Math.abs)) },
  benchmark: { period: '2024-01-01 to 2026-01-01, hourly', samples: B_N, sites: benchmark },
};
writeFileSync(join(FIX, 'comparison.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(comparison, null, 1));
console.log('demCheck', out.demCheck);
console.log('benchmark', JSON.stringify(benchmark));
