// Version 2 data for the demo deck (public/deck/ribbon-data.js): the opening story as the app shows
// it (D-056), built with the app's own code (planView, the v2 skyline files, the DSN series).
// Same structure as version 1's export (pipeline/export-demo-assets.ts), plus plan B's Earth path
// through the stay and the spans when terrain hides Earth, which slide 5 draws.
// Run: node pipeline/export-deck-v2.ts      Output: public/deck/ribbon-data.js

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
const { PROFILES, nextWindow } = await import('../src/engine/mission.ts');
const { horizonAt } = await import('../src/engine/horizon.ts');
const { obstructionKmAt, compassName } = await import('../src/engine/verdict.ts');
const { centreMask, terrainOfGrid } = await import('../src/engine/maskV2.ts');
const { computeDsnSeries } = await import('../src/engine/dsn.ts');
const { planView, seriesGeometry, fitRange, scanFor } = await import('../src/state/plan.ts');
const { LEAD_DAYS, SERIES_N, STEP_MS } = await import('../src/state/compute.ts');
const { DEFAULTS } = await import('../src/state/scenario.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;
type Envelope = import('../src/engine/ribbonGeometry.ts').Envelope;

const ROOT = join(import.meta.dirname, '..');
const HOUR = 3600000, DAY = 86400000;
const SITE_ID = DEFAULTS.site, HEIGHT = DEFAULTS.heightM, SLIP_DAYS = DEFAULTS.bPlusDays;
const profile = PROFILES.find((p) => p.id === DEFAULTS.profileId)!;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const displayAz = (az: number) => { const w = wrap360(az); return w > 180 ? w - 360 : w; };

const index = JSON.parse(readFileSync(join(ROOT, 'public/masks-v2/index.json'), 'utf8')).sites as { id: string; finestGrid: string }[];
function maskOf(id: string): HorizonMask {
  const e = index.find((s) => s.id === id);
  if (!e) throw new Error('no v2 skyline file for ' + id);
  return centreMask(JSON.parse(readFileSync(join(ROOT, 'public/masks-v2', `${id}.json`), 'utf8')), terrainOfGrid(e.finestGrid));
}
const mask = maskOf(SITE_ID);
const frames = new FrameCache();

function buildPlan(m: HorizonMask, landingMs: number, fr = frames) {
  const startMs = landingMs - LEAD_DAYS * DAY;
  const series = computeSeries(m, HEIGHT, startMs, STEP_MS, SERIES_N, fr);
  const dsn = computeDsnSeries(startMs, STEP_MS, SERIES_N);
  const geom = seriesGeometry(series);
  const scan = scanFor(series, profile, dsn);
  const view = planView(m, series, HEIGHT, landingMs, profile, scan, dsn);
  return { landingMs, series, geom, view };
}
type Plan = ReturnType<typeof buildPlan>;

const A = buildPlan(mask, DEFAULTS.landingMs);
const B = buildPlan(mask, DEFAULTS.landingMs + SLIP_DAYS * DAY);

function bandRuns(env: Envelope, radiusDeg: number) {
  const runs: number[][][] = [];
  let cur: number[][] = [];
  for (let k = 0; k < 360; k++) {
    const bin = (180 + k) % 360;
    const lo = env.minEl[bin], hi = env.maxEl[bin];
    if (Number.isNaN(lo) || Number.isNaN(hi)) { if (cur.length) runs.push(cur); cur = []; continue; }
    const c = bin + 0.5;
    cur.push([c > 180 ? c - 360 : c, r3(lo - radiusDeg), r3(hi + radiusDeg)]);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Spans inside [from, to) sample indices when less than half the body's disc is above the skyline. */
function hiddenSpans(p: Plan, body: 'sun' | 'earth', i0: number, i1: number) {
  const s = p.series, frac = body === 'sun' ? s.sunFrac : s.earthFrac, az = body === 'sun' ? s.sunAz : s.earthAz;
  const out: { startH: number; endH: number; hours: number; azMin: number; azMax: number; compass: string; distKmMin: number | null; distKmMax: number | null }[] = [];
  let k = i0;
  while (k < i1) {
    if (frac[k] >= 0.5) { k++; continue; }
    let j = k;
    while (j + 1 < i1 && frac[j + 1] < 0.5) j++;
    const azs: number[] = [], ds: number[] = [];
    for (let i = k; i <= j; i++) { azs.push(displayAz(az[i])); const d = obstructionKmAt(mask, HEIGHT, az[i]); if (d !== null) ds.push(d); }
    out.push({
      startH: k - p.view.landingIdx, endH: j + 1 - p.view.landingIdx, hours: j + 1 - k,
      azMin: r2(Math.min(...azs)), azMax: r2(Math.max(...azs)), compass: compassName(az[Math.floor((k + j) / 2)]),
      distKmMin: ds.length ? r1(Math.min(...ds)) : null, distKmMax: ds.length ? r1(Math.max(...ds)) : null,
    });
    k = j + 1;
  }
  return out;
}

/** Dark spans as pieces on the strip, split where the Sun's azimuth wraps past south (as Ribbon.tsx draws them). */
function spanPieces(p: Plan, stayEndMs: number) {
  const s = p.series;
  const out: { x0: number; x1: number; id: number; days: number; inStayHours: number; afterStay: boolean; label: boolean }[] = [];
  p.view.spans.forEach((sp, id) => {
    const i0 = Math.max(0, Math.ceil((sp.startMs - s.startMs) / s.stepMs));
    const i1 = Math.min(s.n - 1, Math.floor((sp.endMs - s.startMs) / s.stepMs));
    const xs: number[] = [displayAz(sp.azStart)];
    for (let i = i0; i <= i1; i++) xs.push(displayAz(s.sunAz[i]));
    xs.push(displayAz(sp.azEnd));
    const pieces: number[][] = [];
    let cur: number[] = [];
    xs.forEach((x, i) => { if (i > 0 && Math.abs(x - xs[i - 1]) > 180) { if (cur.length > 1) pieces.push(cur); cur = []; } cur.push(x); });
    if (cur.length > 1) pieces.push(cur);
    const inStay = r1(Math.max(0, Math.min(sp.endMs, stayEndMs) - Math.max(sp.startMs, p.landingMs)) / HOUR);
    const ps = pieces.map((pc) => ({ x0: r3(Math.min(...pc)), x1: r3(Math.max(...pc)) }));
    const widest = ps.reduce((b, q, k) => (q.x1 - q.x0 > ps[b].x1 - ps[b].x0 ? k : b), 0);
    ps.forEach((q, k) => out.push({ ...q, id, days: r2(sp.days), inStayHours: inStay, afterStay: sp.startMs >= stayEndMs, label: k === widest }));
  });
  return out;
}

const planData = (p: Plan) => {
  const stayEndMs = p.series.startMs + p.view.stayEndIdx * p.series.stepMs;
  const h = (ms: number) => r2((ms - p.landingMs) / HOUR);
  const s = p.series, L = p.view.landingIdx, E = p.view.stayEndIdx;
  const earthStay: number[][] = [];
  for (let i = L; i <= Math.min(E, s.n - 1); i++) earthStay.push([i - L, r3(displayAz(s.earthAz[i])), r3(s.earthEl[i]), r2(s.earthFrac[i]), r3(s.earthHorizon[i])]);
  return {
    landingUtc: iso(p.landingMs),
    landingMs: p.landingMs,
    stayEndHours: h(stayEndMs),
    sun: p.view.sunPath.map((q) => [h(q.ms), r3(displayAz(q.az)), r3(q.el), r2(q.frac)]),
    earth: p.view.earthPath.map((q) => [h(q.ms), r3(displayAz(q.az)), r3(q.el), r2(q.frac)]),
    // [hours after landing, azimuth, elevation, disc fraction above the skyline, skyline elevation at Earth's azimuth]
    earthStay,
    earthHidden: hiddenSpans(p, 'earth', L, E),
    sunHidden: hiddenSpans(p, 'sun', L, E),
    ticks: p.view.ticks.map((t) => [t.day, r3(displayAz(t.az)), r3(t.el)]),
    spans: spanPieces(p, stayEndMs),
    slipMarginHours: r1(p.view.slipMarginMs / HOUR),
    power: p.view.power,
    verdict: { word: p.view.verdict.word, sentences: p.view.verdict.sentences },
  };
};

const skyline: number[] = [];
const profileArr = mask.horizonDeg[String(HEIGHT)];
for (let d = -180; d <= 180; d += 0.5) skyline.push(r3(horizonAt(profileArr, mask.azStepDeg, d)));
const range = fitRange([A, B].map((p) => ({ geom: p.geom, sunRadiusDeg: p.view.sunRadiusDeg, earthRadiusDeg: p.view.earthRadiusDeg })));
const nw = nextWindow(B.view.scan, B.landingMs);

// Sites the title and closing slides cycle through, one lunar day each, from plan A's landing.
const DECK_SITES: [string, string][] = [
  [SITE_ID, 'Malapert Massif'],
  ['pgda-site07-peak-near-shackleton-crest', 'Peak near Shackleton crater'],
  ['pgda-site01-connecting-ridge-crest', 'Connecting Ridge'],
  ['mons-mouton', 'Mons Mouton'],
  ['im-2-athena', 'Athena (IM-2) landing site'],
];
const deckFrames = new FrameCache();
let startMs = A.landingMs;
const sites = DECK_SITES.map(([id, label]) => {
  const m = maskOf(id);
  const p = buildPlan(m, startMs, deckFrames);
  const thisStart = startMs;
  startMs += (Math.ceil(p.view.sunPath.length / 2) - 1) * 2 * HOUR;
  const arr = m.horizonDeg[String(HEIGHT)];
  const sky: number[] = [];
  for (let d = -180; d <= 180; d += 0.5) sky.push(r2(horizonAt(arr, m.azStepDeg, d)));
  const pts = (path: { az: number; el: number; frac: number }[], every: number) => path.filter((_, i) => i % every === 0).map((q) => [r2(displayAz(q.az)), r2(q.el), r2(q.frac)]);
  return {
    id, label, lat: m.lat, lon: m.lon, startMs: thisStart, startUtc: iso(thisStart), skyline: sky,
    sunBand: bandRuns(p.geom.sunBand, p.view.sunRadiusDeg), earthRegion: bandRuns(p.geom.earthRegion, p.view.earthRadiusDeg),
    sunStepH: 2, earthStepH: 4, sun: pts(p.view.sunPath, 2), earth: pts(p.view.earthPath, 2),
    sunUpShareThisLunation: r2(p.view.sunPath.filter((q) => q.frac >= 0.5).length / p.view.sunPath.length),
  };
});

const deck = {
  generatedBy: 'node pipeline/export-deck-v2.ts, from src/engine and src/state; do not edit by hand',
  site: { id: SITE_ID, name: mask.name, lat: mask.lat, lon: mask.lon, observerHeightM: HEIGHT, profile: profile.label, terrain: mask.terrain },
  elevationRangeDeg: [range.min, range.max],
  skylineStepDeg: 0.5,
  skyline,
  sunRadiusDeg: r3(A.view.sunRadiusDeg),
  earthRadiusDeg: r3(A.view.earthRadiusDeg),
  sunBand: bandRuns(A.geom.sunBand, A.view.sunRadiusDeg),
  earthRegion: bandRuns(A.geom.earthRegion, A.view.earthRadiusDeg),
  slipDays: SLIP_DAYS,
  A: planData(A),
  B: planData(B),
  next: nw ? { landingUtc: iso(nw.startMs), landingMs: nw.startMs, daysAfterB: r2((nw.startMs - B.landingMs) / DAY) } : null,
  sites,
};
const deckDir = join(ROOT, 'public', 'deck');
mkdirSync(deckDir, { recursive: true });
writeFileSync(join(deckDir, 'ribbon-data.js'), '// ' + deck.generatedBy + '\nwindow.RIBBON_DATA = ' + JSON.stringify(deck) + ';\n');
console.log(`A ${deck.A.landingUtc}: ${deck.A.verdict.word}, slip ${deck.A.slipMarginHours} h; ${deck.A.verdict.sentences.join(' ')}`);
console.log(`B ${deck.B.landingUtc}: ${deck.B.verdict.word}; ${deck.B.verdict.sentences.join(' ')}`);
console.log('B Earth hidden in stay:', JSON.stringify(deck.B.earthHidden));
console.log('B Sun hidden in stay:', JSON.stringify(deck.B.sunHidden));
console.log('next', JSON.stringify(deck.next), 'range', deck.elevationRangeDeg);
console.log('earth az/el range in B stay:', Math.min(...deck.B.earthStay.map((e) => e[1])), Math.max(...deck.B.earthStay.map((e) => e[1])), Math.min(...deck.B.earthStay.map((e) => e[2])), Math.max(...deck.B.earthStay.map((e) => e[2])));
for (const st of sites) console.log(`deck site ${st.id} from ${st.startUtc}: Sun up ${Math.round(st.sunUpShareThisLunation * 100)}%`);
