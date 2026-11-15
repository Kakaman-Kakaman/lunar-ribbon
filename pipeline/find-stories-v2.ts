// D-046: find the version 2 opening story. For each precisely located point (position radius at most
// 30 m: crest points and real landing sites), short-stay rules (REQUIREMENT_PRESETS 'short-stay'),
// 2 m, landing times every 6 h through 2027-2028: a pair (A, B = A + N days, N = 1..7) qualifies when
// A works and B fails at the centre and at all 16 band points, and the cause of B's failure is the
// same everywhere. Ranked by the delay to B's next window, then by A's smallest slip margin.
// Run: node pipeline/find-stories-v2.ts      Output: pipeline/out/stories-v2.json

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
const { REQUIREMENT_PRESETS, evaluateRequirements, stayCount } = await import('../src/engine/requirements.ts');
const { computeDsnSeries } = await import('../src/engine/dsn.ts');
const { loadTerrainStack, roundingRadiusM } = await import('./terrain-stack.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;

const ROOT = join(import.meta.dirname, '..');
const HOUR = 3600000, DAY = 86400000;
const START = Date.UTC(2027, 0, 1), END_LANDING = Date.UTC(2029, 0, 1);
const N = Math.round((END_LANDING - START) / HOUR) + 24 * 60; // room for the stay and the next window
const STRIDE = 6;
const MAX_RADIUS_M = 30;
const DEG = Math.PI / 180;
const req = REQUIREMENT_PRESETS.find((p) => p.id === 'short-stay')!.req;

const { stack } = loadTerrainStack();
console.log(`nested stack: ${stack.map((g) => g.name).join(' > ')}`);
const frames = new FrameCache();
const dsn = computeDsnSeries(START, HOUR, N);

function offset(lat: number, lon: number, azDeg: number, d: number): [number, number] {
  const t = d / MOON_RADIUS_M, a = azDeg * DEG, la = lat * DEG;
  const s2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
  const lat2 = Math.asin(s2);
  const lon2 = lon * DEG + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * s2);
  return [lat2 / DEG, ((((lon2 / DEG) + 540) % 360) - 180)];
}

const index = JSON.parse(readFileSync(join(ROOT, 'public/masks/index.json'), 'utf8')) as { id: string; name: string; lat: number; lon: number }[];
const cnt = stayCount(req, HOUR);
const nCand = Math.floor((END_LANDING - START) / HOUR / STRIDE);
const stories: any[] = [];

for (const site of index) {
  const [sx, sy] = llToXY(site.lat, site.lon);
  const local = stack.find((g) => !Number.isNaN(sampleDem(g, sx, sy)));
  if (!local || local.scaleM > 20) continue;
  const radius = Math.max(roundingRadiusM(site.lat, site.lon), local.scaleM);
  if (radius > MAX_RADIUS_M) continue;
  const t0 = Date.now();
  const pts: [number, number][] = [[site.lat, site.lon]];
  for (const f of [0.5, 1]) for (let k = 0; k < 8; k++) pts.push(offset(site.lat, site.lon, k * 45, f * radius));
  // ok[p][c]: does landing candidate c work at point p; cause[p][c]: failures joined.
  const ok: Uint8Array[] = [], cause: string[][] = [];
  for (const [la, lo] of pts) {
    const hp = horizonProfile({ lat: la, lon: lo, heightsM: [2], near: null, far: null, azStepDeg: 0.1, grids: stack.map((grid) => ({ grid })) });
    const mask: HorizonMask = { id: site.id, name: site.name, lat: la, lon: lo, groundElevM: hp.groundElevM, terrain: 'lola-80m+240m', azStepDeg: 0.1, heightsM: [2], horizonDeg: { '2': hp.horizonDeg[0] } };
    const s = computeSeries(mask, 2, START, HOUR, N, frames);
    const o = new Uint8Array(nCand), c: string[] = new Array(nCand);
    for (let k = 0; k < nCand; k++) {
      const L = k * STRIDE;
      if (L + cnt > N) break;
      const r = evaluateRequirements(s, L, req, dsn);
      o[k] = r.ok ? 1 : 0;
      c[k] = r.failures.join('+');
    }
    ok.push(o); cause.push(c);
  }
  const allOk = (k: number) => ok.every((o) => o[k] === 1);
  const allFailSame = (k: number) => ok.every((o) => o[k] === 0) && cause.every((c) => c[k] === cause[0][k]);
  let found = 0;
  for (let a = 0; a < nCand; a++) {
    if (!allOk(a)) continue;
    let margin = 0; // smallest slip margin over the band, in candidates
    for (let p = 0; p < ok.length; p++) { let j = a; while (j + 1 < nCand && ok[p][j + 1]) j++; margin = p === 0 ? j - a : Math.min(margin, j - a); }
    for (let nDays = 1; nDays <= 7; nDays++) {
      const b = a + (nDays * 24) / STRIDE;
      if (b >= nCand || !allFailSame(b)) continue;
      let m = b; while (m < nCand && !ok[0][m]) m++;
      if (m >= nCand) continue;
      stories.push({
        site: site.id, radiusM: Math.round(radius), finestGrid: local.name,
        planA: new Date(START + a * STRIDE * HOUR).toISOString().slice(0, 16), planBDays: nDays,
        bCause: cause[0][b], slipMarginH: margin * STRIDE, nextWindowAfterB_days: ((m - b) * STRIDE) / 24,
      });
      found++;
    }
  }
  console.log(`${site.id.padEnd(42)} r ${radius.toFixed(0).padStart(3)} m: ${found} robust A/B pairs | ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
stories.sort((x, y) => y.nextWindowAfterB_days - x.nextWindowAfterB_days || y.slipMarginH - x.slipMarginH);
mkdirSync(join(ROOT, 'pipeline/out'), { recursive: true });
writeFileSync(join(ROOT, 'pipeline/out/stories-v2.json'), JSON.stringify({ generated: new Date().toISOString(), stack: stack.map((g) => g.name), rules: 'short-stay preset, 2 m, robust across the sensitivity band', count: stories.length, stories }, null, 1));
console.log(`${stories.length} robust pairs; top 15:`);
for (const s of stories.slice(0, 15)) console.log(`  ${s.site} A ${s.planA} B +${s.planBDays} d fails (${s.bCause}); A margin ${s.slipMarginH} h; next window ${s.nextWindowAfterB_days} d after B`);
