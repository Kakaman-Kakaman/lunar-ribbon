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

const { horizonProfile, sampleDem, llToXY, MOON_RADIUS_M } = await import('../src/engine/raymarch.ts');
const { packInt16 } = await import('../src/engine/maskV2.ts');
const { loadTerrainStack, roundingRadiusM } = await import('./terrain-stack.ts');
type MaskV2 = import('../src/engine/maskV2.ts').MaskV2;

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'masks-v2');
const HEIGHTS = [1, 2, 5, 10];
const AZ_CENTRE = 0.1, AZ_BAND = 0.5, AZ_RIDGES = 0.5;
const DEG = Math.PI / 180;

const { stack } = loadTerrainStack();
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
const grids = stack.map((grid) => ({ grid }));
const outIndex: any[] = [];
let bytes = 0;
for (const site of index) {
  const t0 = Date.now();
  const [sx, sy] = llToXY(site.lat, site.lon);
  const local = stack.find((g) => !Number.isNaN(sampleDem(g, sx, sy)))!;
  const rounding = roundingRadiusM(site.lat, site.lon);
  const radius = Math.max(rounding, local.scaleM);

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
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ version: 2, terrain, heightsM: HEIGHTS, sites: outIndex }, null, 1) + '\n');
console.log(`wrote ${outIndex.length} files, ${(bytes / 1048576).toFixed(1)} MB`);
