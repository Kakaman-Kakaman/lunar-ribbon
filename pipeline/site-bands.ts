// D-043: how much each site's results depend on where exactly the point is. For every masked site,
// skylines at the published point and at 16 points around it (rings at half and full radius, 8
// directions each), at 1, 2, 5 and 10 m (D-044), on the nested fine terrain. The radius is the
// larger of the coordinate's rounding radius and one pixel of the finest grid at the site.
// Run: node pipeline/site-bands.ts      Output: pipeline/out/site-bands.json

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
const { horizonProfile, sampleDem, llToXY, MOON_RADIUS_M } = await import('../src/engine/raymarch.ts');
const { loadTerrainStack, loadMainStack, roundingRadiusM } = await import('./terrain-stack.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;

const ROOT = join(import.meta.dirname, '..');
const HOUR = 3600000;
const HEIGHTS = [1, 2, 5, 10];
const AZ = 0.1;
const START = Date.UTC(2024, 0, 1), N = Math.round((Date.UTC(2026, 0, 1) - START) / HOUR);
const DEG = Math.PI / 180;

const { stack, skipped, source: terrainSource } = await loadMainStack();
console.log(`terrain: ${terrainSource}`);
console.log(`nested stack: ${stack.map((g) => g.name).join(' > ')}${skipped.length ? ` | skipped: ${skipped.map((s) => s.split(':')[0]).join(', ')}` : ''}`);

/** Point at distance d (m) and azimuth a (deg) from (lat, lon), great circle on the 1737.4 km sphere. */
function offset(lat: number, lon: number, azDeg: number, d: number): [number, number] {
  const t = d / MOON_RADIUS_M, a = azDeg * DEG, la = lat * DEG;
  const s2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
  const lat2 = Math.asin(s2);
  const lon2 = lon * DEG + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * s2);
  return [lat2 / DEG, ((((lon2 / DEG) + 540) % 360) - 180)];
}

const frames = new FrameCache();
function shares(mask: HorizonMask, h: number) {
  const s = computeSeries(mask, h, START, HOUR, N, frames);
  let sm = 0, su = 0, eu = 0;
  for (let i = 0; i < N; i++) { sm += s.sunFrac[i]; if (s.sunFrac[i] >= 0.5) su++; if (s.earthFrac[i] >= 0.5) eu++; }
  return { sunMean: sm / N, sunUp: su / N, earthUp: eu / N };
}

const index = JSON.parse(readFileSync(join(ROOT, 'public/masks/index.json'), 'utf8')) as { id: string; name: string; lat: number; lon: number; sourceQuality?: string }[];
const out: any[] = [];
const pct = (v: number) => (100 * v).toFixed(0).padStart(3);
for (const site of index) {
  const [sx, sy] = llToXY(site.lat, site.lon);
  const local = stack.find((g) => !Number.isNaN(sampleDem(g, sx, sy)));
  if (!local) continue;
  const rounding = roundingRadiusM(site.lat, site.lon);
  const radius = Math.max(rounding, local.scaleM);
  const pts: { lat: number; lon: number; dM: number; azDeg: number }[] = [{ lat: site.lat, lon: site.lon, dM: 0, azDeg: 0 }];
  for (const f of [0.5, 1]) for (let k = 0; k < 8; k++) {
    const [la, lo] = offset(site.lat, site.lon, k * 45, f * radius);
    pts.push({ lat: la, lon: lo, dM: f * radius, azDeg: k * 45 });
  }
  const t0 = Date.now();
  const results = pts.map((p) => {
    const hp = horizonProfile({ lat: p.lat, lon: p.lon, heightsM: HEIGHTS, near: null, far: null, azStepDeg: AZ, grids: stack.map((grid) => ({ grid })) });
    const horizonDeg: Record<string, number[]> = {};
    HEIGHTS.forEach((h, i) => (horizonDeg[String(h)] = hp.horizonDeg[i]));
    const mask: HorizonMask = { id: site.id, name: site.name, lat: p.lat, lon: p.lon, groundElevM: hp.groundElevM, terrain: 'lola-80m+240m', azStepDeg: AZ, heightsM: HEIGHTS, horizonDeg };
    return { ...p, groundM: hp.groundElevM, byHeight: Object.fromEntries(HEIGHTS.map((h) => [h, shares(mask, h)])) };
  });
  const band = Object.fromEntries(HEIGHTS.map((h) => {
    const sun = results.map((r) => r.byHeight[h].sunUp), earth = results.map((r) => r.byHeight[h].earthUp);
    return [h, { sunUp: { centre: sun[0], min: Math.min(...sun), max: Math.max(...sun) }, earthUp: { centre: earth[0], min: Math.min(...earth), max: Math.max(...earth) } }];
  }));
  out.push({ id: site.id, lat: site.lat, lon: site.lon, sourceQuality: site.sourceQuality, finestGrid: local.name, roundingRadiusM: Math.round(rounding), radiusM: Math.round(radius), groundRangeM: [Math.min(...results.map((r) => r.groundM)), Math.max(...results.map((r) => r.groundM))], band, points: results });
  console.log(`${site.id.padEnd(42)} r ${String(Math.round(radius)).padStart(5)} m | Sun up % at 1/2/5/10 m: ${HEIGHTS.map((h) => `${pct(band[h].sunUp.centre)} [${pct(band[h].sunUp.min)}-${pct(band[h].sunUp.max)}]`).join('  ')} | ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
mkdirSync(join(ROOT, 'pipeline/out'), { recursive: true });
writeFileSync(join(ROOT, 'pipeline/out/site-bands.json'), JSON.stringify({ generated: new Date().toISOString(), stack: stack.map((g) => g.name), period: '2024-01-01 to 2026-01-01, hourly', heightsM: HEIGHTS, azStepDeg: AZ, sites: out }, null, 1));
console.log('wrote pipeline/out/site-bands.json');
