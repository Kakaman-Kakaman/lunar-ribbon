// E6 check (docs/PLAN-V2.md): the version 1 opening story re-run under version 2 terrain and rules.
// Malapert Massif listed point (NASA Goddard study site 23), 2 m, plan A 2027-10-13 18:00 UTC, plan B
// three days later. Reports v1 terrain + v1 rules (should reproduce version 1), fine terrain + v1
// rules, fine terrain + v2 short-stay rules, and the v2 verdict at 16 points around the site within
// its coordinate rounding radius (D-043).
// Run: node pipeline/story-v2.ts      Output: pipeline/out/story-v2.json

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
const { horizonProfile, MOON_RADIUS_M } = await import('../src/engine/raymarch.ts');
const { PROFILES, evaluate, slipScan, slipMarginMs, nextWindow } = await import('../src/engine/mission.ts');
const { REQUIREMENT_PRESETS, evaluateRequirements, scanRequirements } = await import('../src/engine/requirements.ts');
const { computeDsnSeries } = await import('../src/engine/dsn.ts');
const { loadTerrainStack, loadMainStack, roundingRadiusM } = await import('./terrain-stack.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;
type SiteSeries = import('../src/engine/visibility.ts').SiteSeries;

const ROOT = join(import.meta.dirname, '..');
const HOUR = 3600000, DAY = 86400000;
const START = Date.UTC(2027, 9, 1), N = 24 * 400;
const PLAN_A = Date.UTC(2027, 9, 13, 18), PLAN_B = PLAN_A + 3 * DAY;
const iA = (PLAN_A - START) / HOUR, iB = (PLAN_B - START) / HOUR;
const DEG = Math.PI / 180;

const site = JSON.parse(readFileSync(join(ROOT, 'public/masks/pgda-site23-malapert-massif.json'), 'utf8')) as HorizonMask;
const { stack, source: terrainSource } = await loadMainStack();
console.log(`terrain: ${terrainSource}`);
console.log(`nested stack: ${stack.map((g) => g.name).join(' > ')}`);
const frames = new FrameCache();
const dsn = computeDsnSeries(START, HOUR, N);
const shortV1 = PROFILES.find((p) => p.id === 'short-stay')!;
const shortV2 = REQUIREMENT_PRESETS.find((p) => p.id === 'short-stay')!;

function fineMask(lat: number, lon: number): HorizonMask {
  const hp = horizonProfile({ lat, lon, heightsM: [2], near: null, far: null, azStepDeg: 0.1, grids: stack.map((grid) => ({ grid })) });
  return { ...site, lat, lon, groundElevM: hp.groundElevM, azStepDeg: 0.1, heightsM: [2], horizonDeg: { '2': hp.horizonDeg[0] } };
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

function v1Rules(s: SiteSeries) {
  const scan = slipScan(s, shortV1, 0, N, 6);
  const a = evaluate(s, iA, shortV1), b = evaluate(s, iB, shortV1);
  const next = nextWindow(scan, PLAN_B);
  return {
    A: { ok: a.ok, failures: a.failures, slipMarginH: slipMarginMs(scan, PLAN_A) / HOUR },
    B: { ok: b.ok, failures: b.failures, firstFailureAfterH: b.firstFailureAfterH, longestDarkH: b.longestDarkGapH, nextWindow: next ? iso(next.startMs) : null, nextAfterDays: next ? (next.startMs - PLAN_B) / DAY : null },
  };
}
function v2Rules(s: SiteSeries) {
  const a = evaluateRequirements(s, iA, shortV2.req, dsn), b = evaluateRequirements(s, iB, shortV2.req, dsn);
  const scan = scanRequirements(s, shortV2.req, 0, N, 6, dsn);
  const k = (PLAN_A - scan.startMs) / scan.stepMs;
  let j = k; while (scan.ok[k] && j + 1 < scan.ok.length && scan.ok[j + 1]) j++;
  let m = (PLAN_B - scan.startMs) / scan.stepMs; while (m < scan.ok.length && !scan.ok[m]) m++;
  return {
    A: { ok: a.ok, failures: a.failures, slipMarginH: scan.ok[k] ? (j - k) * 6 : 0, minChargeFrac: a.minChargeFrac, worstDayContactH: a.worstDayContactH },
    B: { ok: b.ok, failures: b.failures, firstFailureAfterH: b.firstFailureAfterH, longestDarkH: b.longestDarkH, minChargeFrac: b.minChargeFrac, worstDayContactH: b.worstDayContactH, nextWindow: m < scan.ok.length ? iso(scan.startMs + m * scan.stepMs) : null, nextAfterDays: m < scan.ok.length ? (scan.startMs + m * scan.stepMs - PLAN_B) / DAY : null },
  };
}

const v1Series = computeSeries(site, 2, START, HOUR, N, frames);
const centre = fineMask(site.lat, site.lon);
const fineSeries = computeSeries(centre, 2, START, HOUR, N, frames);
const out: any = {
  site: site.id, heightM: 2, planA: iso(PLAN_A), planB: iso(PLAN_B),
  v1TerrainV1Rules: v1Rules(v1Series),
  fineTerrainV1Rules: v1Rules(fineSeries),
  fineTerrainV2Rules: v2Rules(fineSeries),
};
console.log(JSON.stringify(out, null, 1));

// Band: 16 points around the site within its rounding radius.
const radius = Math.max(roundingRadiusM(site.lat, site.lon), stack[0].scaleM);
function offset(lat: number, lon: number, azDeg: number, d: number): [number, number] {
  const t = d / MOON_RADIUS_M, a = azDeg * DEG, la = lat * DEG;
  const s2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
  const lat2 = Math.asin(s2);
  const lon2 = lon * DEG + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * s2);
  return [lat2 / DEG, ((((lon2 / DEG) + 540) % 360) - 180)];
}
out.band = { radiusM: Math.round(radius), points: [] as any[] };
for (const f of [0.5, 1]) for (let k = 0; k < 8; k++) {
  const [la, lo] = offset(site.lat, site.lon, k * 45, f * radius);
  const s = computeSeries(fineMask(la, lo), 2, START, HOUR, N, frames);
  const r = v2Rules(s);
  out.band.points.push({ dM: Math.round(f * radius), azDeg: k * 45, A: r.A.ok, B: r.B.ok, aFail: r.A.failures, bFail: r.B.failures, slipMarginH: r.A.slipMarginH, nextAfterDays: r.B.nextAfterDays });
  console.log(`  ${String(Math.round(f * radius)).padStart(4)} m at ${String(k * 45).padStart(3)} deg: A ${r.A.ok ? 'works' : 'fails ' + r.A.failures.join('+')}, B ${r.B.ok ? 'works' : 'fails ' + r.B.failures.join('+')}`);
}
mkdirSync(join(ROOT, 'pipeline/out'), { recursive: true });
writeFileSync(join(ROOT, 'pipeline/out/story-v2.json'), JSON.stringify(out, null, 1));
