// Builds version 2 skyline files (src/engine/maskV2.ts) for every site that has real terrain, on the
// nested fine terrain: the published point at 0.1 degree with ridge layers, and 16 band points within
// the site's position radius at 0.5 degree (D-043), for 1, 2, 5 and 10 m (D-044).
// Run: node pipeline/build-masks-v2.ts      Output: public/masks-v2/<id>.json and index.json

import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
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

const { horizonProfile, sampleDem, llToXY, xyToLL, MOON_RADIUS_M } = await import('../src/engine/raymarch.ts');
const { packInt16 } = await import('../src/engine/maskV2.ts');
const { loadTerrainStack, loadMainStack, loadNorthStack, roundingRadiusM } = await import('./terrain-stack.ts');
type LolaGrid = import('./lola.ts').LolaGrid;
type MaskV2 = import('../src/engine/maskV2.ts').MaskV2;

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'masks-v2');
const HEIGHTS = [1, 2, 5, 10];
const AZ_CENTRE = 0.1, AZ_BAND = 0.5, AZ_RIDGES = 0.5;
const DEG = Math.PI / 180;

const { stack, source: terrainSource } = await loadMainStack();
console.log(`terrain: ${terrainSource}`);
const terrain = stack.map((g) => g.name);
console.log(`nested stack: ${terrain.join(' > ')}`);

function offset(lat: number, lon: number, azDeg: number, d: number): [number, number] {
  const t = d / MOON_RADIUS_M, a = azDeg * DEG, la = lat * DEG;
  const s2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
  const lat2 = Math.asin(s2);
  const lon2 = lon * DEG + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * s2);
  return [Math.round((lat2 / DEG) * 1e6) / 1e6, Math.round(((((lon2 / DEG) + 540) % 360) - 180) * 1e6) / 1e6];
}

const index = JSON.parse(readFileSync(join(ROOT, 'public/masks/index.json'), 'utf8')) as any[];
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(join(OUT, f));
const outIndex: any[] = [];
let bytes = 0;

/** Highest pixel of the finest grid within 8 km of a point (the "crest" variant, as for the south). */
function crestOf(site: any, g: LolaGrid, pole: 'south' | 'north') {
  const [cx, cy] = llToXY(site.lat, site.lon, pole);
  const rad = 8000, pr = Math.ceil(rad / g.scaleM) + 2;
  const c0 = Math.round(cx / g.scaleM + g.offsetPx), r0 = Math.round(g.offsetPx - cy / g.scaleM);
  let best = -Infinity, bx = cx, by = cy;
  for (let r = r0 - pr; r <= r0 + pr; r++) for (let c = c0 - pr; c <= c0 + pr; c++) {
    if (r < 0 || c < 0 || r >= g.size || c >= g.size) continue;
    const x = (c - g.offsetPx) * g.scaleM, y = (g.offsetPx - r) * g.scaleM;
    if (Math.hypot(x - cx, y - cy) > rad) continue;
    const v = g.data[r * g.size + c];
    if (v > best) { best = v; bx = x; by = y; }
  }
  const [lat, lon] = xyToLL(bx, by, pole);
  return {
    ...site, id: `${site.id}-crest`, name: `${site.name.replace(' (crater, centre)', '')} — highest point within 8 km of the crater centre`,
    lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, sourceQuality: 'derived',
    note: `Derived from ${g.name}: the highest pixel within 8 km of the crater centre (${site.lat}, ${site.lon}); height ${best * g.dnToM} m. ${site.note}`,
  };
}

function buildSite(site: any, stack: LolaGrid[], pole: 'south' | 'north') {
  const grids = stack.map((grid) => ({ grid }));
  const t0 = Date.now();
  const [sx, sy] = llToXY(site.lat, site.lon, pole);
  const local = stack.find((g) => !Number.isNaN(sampleDem(g, sx, sy)))!;
  const rounding = roundingRadiusM(site.lat, site.lon);
  const radius = Math.max(rounding, local.scaleM);

  const terrain = stack.map((g) => g.name);
  const c = horizonProfile({ lat: site.lat, lon: site.lon, heightsM: HEIGHTS, near: null, far: null, azStepDeg: AZ_CENTRE, grids });
  const r = horizonProfile({ lat: site.lat, lon: site.lon, heightsM: HEIGHTS, near: null, far: null, azStepDeg: AZ_RIDGES, grids, ridges: {} });
  const by = <T,>(f: (i: number) => T) => Object.fromEntries(HEIGHTS.map((h, i) => [String(h), f(i)]));
  const centre: MaskV2['centre'] = {
    lat: site.lat, lon: site.lon, groundElevM: Math.round(c.groundElevM * 10) / 10,
    azStepDeg: AZ_CENTRE,
    horizon: by((i) => packInt16(c.horizonDeg[i].map((v) => v * 100))),
    distance: by((i) => packInt16(c.distKm[i].map((v) => v * 100))),
    ridgeAzStepDeg: AZ_RIDGES,
    ridgeCount: by((i) => packInt16(r.ridges![i].map((l) => l.length))),
    ridges: by((i) => packInt16(r.ridges![i].flatMap((l) => l.flatMap(([d, e]) => [d * 100, e * 100])))),
  };
  const points: MaskV2['band']['points'] = [];
  for (const f of [0.5, 1]) for (let k = 0; k < 8; k++) {
    const [la, lo] = offset(site.lat, site.lon, k * 45, f * radius);
    const p = horizonProfile({ lat: la, lon: lo, heightsM: HEIGHTS, near: null, far: null, azStepDeg: AZ_BAND, grids });
    points.push({ lat: la, lon: lo, groundElevM: Math.round(p.groundElevM * 10) / 10, horizon: by((i) => packInt16(p.horizonDeg[i].map((v) => v * 100))) });
  }
  const mask: MaskV2 = {
    version: 2, id: site.id, name: site.name, lat: site.lat, lon: site.lon, group: site.group, terrain, heightsM: HEIGHTS, centre,
    band: { radiusM: Math.round(radius), roundingRadiusM: Math.round(rounding), azStepDeg: AZ_BAND, points },
    source: site.source, sourceQuality: site.sourceQuality, note: site.note,
  };
  const text = JSON.stringify(mask);
  bytes += text.length;
  writeFileSync(join(OUT, `${site.id}.json`), text);
  outIndex.push({ id: site.id, name: site.name, lat: site.lat, lon: site.lon, group: site.group, finestGrid: local.name, groundElevM: centre.groundElevM, bandRadiusM: Math.round(radius), source: site.source, sourceQuality: site.sourceQuality, note: site.note });
  console.log(`${site.id.padEnd(42)} ${(text.length / 1024).toFixed(0).padStart(4)} KB, band ${Math.round(radius)} m, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

for (const site of index) buildSite(site, stack, 'south');

// North pole (E9): IAU craters and their highest points within 8 km, on the north stack.
const north = loadNorthStack();
if (north.stack.length && !process.argv.includes('--south-only')) {
  console.log(`north stack: ${north.stack.map((g) => g.name).join(' > ')}${north.skipped.length ? ` | skipped: ${north.skipped.map((x) => x.split(':')[0]).join(', ')}` : ''}`);
  const fine = north.stack.find((g) => g.scaleM <= 20) ?? north.stack[0];
  const nsites = (JSON.parse(readFileSync(join(ROOT, 'src/data/sites-north.json'), 'utf8')).sites as any[]);
  for (const site of nsites) {
    buildSite(site, north.stack, 'north');
    buildSite(crestOf(site, fine, 'north'), north.stack, 'north');
  }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ version: 2, terrain, heightsM: HEIGHTS, sites: outIndex }, null, 1) + '\n');
console.log(`wrote ${outIndex.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
