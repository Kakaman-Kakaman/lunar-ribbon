// Material for the design team: the opening story's real shapes and numbers.
// Run: node pipeline/export-demo-assets.ts      (npm run demo-assets)
// Output (git-ignored): demo-assets/story/*.svg, demo-assets/story/story.json, demo-assets/numbers.md
//
// Story: Malapert Massif (NASA Goddard study site 23, listed point), profile "short-stay",
// observer 2 m, plan B = plan A + 3 days. Step 1 picks plan A's landing time by a fixed rule from
// six candidate times; step 2 draws that plan pair with the same geometry the app draws.
// All series, plan views, geometry and verdict contexts come from src/ (planView, seriesGeometry,
// fitRange and the engine); nothing here re-implements the astronomy.
// The engine files import each other without the .ts extension, so this registers the same tiny
// resolve hook as pipeline/find-stories.ts and pipeline/validate-illumination.ts.

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
const { fmtDuration, obstructionKmAt, compassName } = await import('../src/engine/verdict.ts');
const { planView, seriesGeometry, fitRange, scanFor } = await import('../src/state/plan.ts');
const { LEAD_DAYS, SERIES_N, STEP_MS } = await import('../src/state/compute.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;
type PlanView = import('../src/state/plan.ts').PlanView;
type SiteSeries = import('../src/engine/visibility.ts').SiteSeries;
type SeriesGeometry = import('../src/state/plan.ts').SeriesGeometry;
type YRange = import('../src/state/plan.ts').YRange;
type Envelope = import('../src/engine/ribbonGeometry.ts').Envelope;
type DarkSpan = import('../src/engine/ribbonGeometry.ts').DarkSpan;

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'demo-assets');
// Optional: --landing=2027-10-13T00:00 exports that plan A time instead of the rule's winner, into story-alt-<stamp>/.
const forcedArg = process.argv.find((a) => a.startsWith('--landing='))?.slice('--landing='.length);
const forcedMs = forcedArg ? Date.parse(forcedArg.endsWith('Z') ? forcedArg : forcedArg + ':00Z') : null;
if (forcedArg && !Number.isFinite(forcedMs)) throw new Error('bad --landing value: ' + forcedArg);
const TAG = forcedMs === null ? '' : '-alt-' + new Date(forcedMs).toISOString().slice(0, 13).replace(/[-T:]/g, '');
const STORY = join(OUT, 'story' + TAG);
mkdirSync(STORY, { recursive: true });

const HOUR = 3600000;
const DAY = 86400000;
const SITE_ID = 'pgda-site23-malapert-massif';
const PROFILE_ID = 'short-stay';
const HEIGHT = 2;
const SLIP_DAYS = 3;
// The ribbon's pixel constants are read from src/ui/Ribbon.tsx (it cannot be imported here: it is a React file).
const ribbonSrc = readFileSync(join(ROOT, 'src', 'ui', 'Ribbon.tsx'), 'utf8');
const constOf = (name: string): number => {
  const m = new RegExp('(?:export )?const ' + name + ' = (\\d+)').exec(ribbonSrc);
  if (!m) throw new Error('constant ' + name + ' not found in src/ui/Ribbon.tsx');
  return Number(m[1]);
};
const PLOT_H_PX = constOf('DEFAULT_PLOT_H'); // plot height when the page does not size it to the window
const PLOT_LEFT = constOf('PLOT_LEFT'), PLOT_RIGHT = constOf('PLOT_RIGHT');

const mask: HorizonMask = JSON.parse(readFileSync(join(ROOT, 'public', 'masks', `${SITE_ID}.json`), 'utf8'));
const profile = PROFILES.find((p: { id: string }) => p.id === PROFILE_ID)!;
const profileArr = mask.horizonDeg[String(HEIGHT)];
const frames = new FrameCache();

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
const wrap360 = (a: number) => ((a % 360) + 360) % 360;
const displayAz = (az: number) => (az > 180 ? az - 360 : az); // same as Ribbon.tsx
const f3 = (x: number) => (Math.round(x * 1000) / 1000).toString();

// ---- One plan, built exactly the way the app builds it ----
interface Plan {
  landingMs: number;
  anchorMs: number;
  series: SiteSeries;
  geom: SeriesGeometry;
  view: PlanView;
}
function buildPlan(landingMs: number): Plan {
  const startMs = landingMs - LEAD_DAYS * DAY; // the app anchors the series on this plan's own landing
  const series = computeSeries(mask, HEIGHT, startMs, STEP_MS, SERIES_N, frames);
  const geom = seriesGeometry(series);
  const scan = scanFor(series, profile);
  const view = planView(mask, series, HEIGHT, landingMs, profile, scan);
  return { landingMs, anchorMs: landingMs, series, geom, view };
}

// ---- Step 1: candidates and the rule ----
const CANDIDATES = [
  Date.UTC(2027, 9, 12, 18),
  Date.UTC(2027, 9, 13, 0),
  Date.UTC(2027, 9, 13, 6),
  Date.UTC(2027, 9, 13, 12),
  Date.UTC(2027, 9, 13, 18),
  Date.UTC(2027, 9, 14, 0),
];
const SUN_ONLY = new Set(['sun-down-at-landing', 'dark-gap']);

/** Samples of the stay, as the engine counts them: landing index .. landing + stayDays (exclusive). */
const stayN = Math.round((profile.stayDays * DAY) / STEP_MS);

function clearanceInStay(p: Plan) {
  const L = p.view.landingIdx;
  let min = Infinity, at = L;
  for (let i = L; i < Math.min(p.series.n, L + stayN); i++) {
    const c = p.series.sunEl[i] - p.series.sunHorizon[i];
    if (c < min) { min = c; at = i; }
  }
  return { minDeg: min, atIdx: at, atHoursAfterLanding: at - L, atUtc: iso(p.series.startMs + at * STEP_MS) };
}
const clearanceAt = (p: Plan, i: number) => p.series.sunEl[i] - p.series.sunHorizon[i];

function overlapH(sp: DarkSpan, Lms: number): number {
  const end = Lms + profile.stayDays * DAY;
  return Math.max(0, Math.min(sp.endMs, end) - Math.max(sp.startMs, Lms)) / HOUR;
}

function describeSpan(p: Plan, sp: DarkSpan) {
  const s = p.series;
  const i0 = Math.max(0, Math.ceil((sp.startMs - s.startMs) / s.stepMs));
  const i1 = Math.min(s.n - 1, Math.floor((sp.endMs - s.startMs) / s.stepMs));
  // Unwrap the azimuth so a sweep across north does not read as 360 degrees.
  const azs = [sp.azStart];
  for (let i = i0; i <= i1; i++) azs.push(s.sunAz[i]);
  azs.push(sp.azEnd);
  let u = azs[0], uMin = u, uMax = u;
  for (let i = 1; i < azs.length; i++) {
    let d = azs[i] - azs[i - 1];
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    u += d;
    uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
  }
  let dMin = Infinity, dMax = -Infinity, hMin = Infinity, hMax = -Infinity, eMin = Infinity, eMax = -Infinity, above0 = 0, cnt = 0;
  for (let i = i0; i <= i1; i++) {
    const d = obstructionKmAt(mask, HEIGHT, s.sunAz[i]);
    if (d !== null) { dMin = Math.min(dMin, d); dMax = Math.max(dMax, d); }
    hMin = Math.min(hMin, s.sunHorizon[i]); hMax = Math.max(hMax, s.sunHorizon[i]);
    eMin = Math.min(eMin, s.sunEl[i]); eMax = Math.max(eMax, s.sunEl[i]);
    if (s.sunEl[i] > 0) above0++;
    cnt++;
  }
  const inStayH = overlapH(sp, p.landingMs);
  const darkSamplesInStay = (() => {
    let n = 0;
    for (let i = p.view.landingIdx; i < Math.min(s.n, p.view.landingIdx + stayN); i++) {
      const t = s.startMs + i * s.stepMs;
      if (t >= sp.startMs - 1 && t <= sp.endMs + 1 && s.sunFrac[i] < 0.5) n++;
    }
    return n;
  })();
  return {
    startUtc: iso(sp.startMs), endUtc: iso(sp.endMs),
    startsHoursAfterLanding: r1((sp.startMs - p.landingMs) / HOUR),
    days: r2(sp.days), hours: r1(sp.days * 24),
    inStayHours: r1(inStayH), inStaySampleHours: darkSamplesInStay,
    startsAfterStay: sp.startMs >= p.landingMs + profile.stayDays * DAY,
    azStartDeg: r1(wrap360(sp.azStart)), azEndDeg: r1(wrap360(sp.azEnd)),
    azStartDisplay: r1(displayAz(wrap360(sp.azStart))), azEndDisplay: r1(displayAz(wrap360(sp.azEnd))),
    azSweepDeg: r1(uMax - uMin), azMidCompass: compassName(azs[Math.floor(azs.length / 2)]),
    terrainDistKmMin: Number.isFinite(dMin) ? r1(dMin) : null, terrainDistKmMax: Number.isFinite(dMax) ? r1(dMax) : null,
    skylineElDegMin: r2(hMin), skylineElDegMax: r2(hMax),
    sunElDegMin: r2(eMin), sunElDegMax: r2(eMax),
    shareOfSpanSunAboveLocalHorizontal: r2(above0 / Math.max(1, cnt)),
    label: spanLabel(inStayH, sp.days),
  };
}
function spanLabel(inStayH: number, days: number): string {
  return inStayH > 0
    ? `${fmtDuration(inStayH)} of the stay / ${fmtDuration(days * 24)} in all`
    : `${fmtDuration(days * 24)} dark (after the stay)`;
}

interface Row {
  landingMs: number;
  a: Plan; b: Plan;
  aWorks: boolean;
  aMarginDays: number;
  aMinClear: ReturnType<typeof clearanceInStay>;
  aClearAtLanding: number;
  bFails: boolean;
  bFailures: string[];
  bSunOnly: boolean;
  bFirstFailureAfterH: number | null;
  bDarkInStaySampleHours: number;
  bDarkInStayInterpHours: number;
  bFullSpan: ReturnType<typeof describeSpan> | null;
  nextLandingMs: number | null;
  nextDelayDays: number | null;
  passes: boolean;
  why: string[];
}

function analyse(landingMs: number): Row {
  const a = buildPlan(landingMs);
  const b = buildPlan(landingMs + SLIP_DAYS * DAY);
  const aMinClear = clearanceInStay(a);
  const bFailures: string[] = [...b.view.ev.failures];
  // The dark span of plan B that overlaps the stay (the first one that does).
  const spanB = b.view.spans.find((sp) => overlapH(sp, b.landingMs) > 0) ?? null;
  const bFull = spanB ? describeSpan(b, spanB) : null;
  let darkSamples = 0;
  for (let i = b.view.landingIdx; i < Math.min(b.series.n, b.view.landingIdx + stayN); i++) if (b.series.sunFrac[i] < 0.5) darkSamples++;
  const nw = nextWindow(b.view.scan, b.landingMs);
  const delay = nw ? (nw.startMs - b.landingMs) / DAY : null;
  const row: Row = {
    landingMs, a, b,
    aWorks: a.view.ev.ok,
    aMarginDays: a.view.slipMarginMs / DAY,
    aMinClear, aClearAtLanding: clearanceAt(a, a.view.landingIdx),
    bFails: !b.view.ev.ok, bFailures,
    bSunOnly: bFailures.length > 0 && bFailures.every((f) => SUN_ONLY.has(f)),
    bFirstFailureAfterH: b.view.ev.firstFailureAfterH,
    bDarkInStaySampleHours: darkSamples,
    bDarkInStayInterpHours: bFull ? bFull.inStayHours : 0,
    bFullSpan: bFull,
    nextLandingMs: nw ? nw.startMs : null,
    nextDelayDays: delay,
    passes: false, why: [],
  };
  if (!row.aWorks) row.why.push('plan A does not work');
  if (!row.bSunOnly) row.why.push(row.bFails ? 'plan B does not fail on the Sun only' : 'plan B does not fail');
  if (!(row.bDarkInStaySampleHours >= 12)) row.why.push(`plan B has ${row.bDarkInStaySampleHours} h dark inside the stay (< 12)`);
  if (!(delay !== null && delay >= 20)) row.why.push(`next window ${delay === null ? 'none' : r1(delay) + ' d'} after plan B (< 20)`);
  row.passes = row.why.length === 0;
  return row;
}

console.log(`Candidates for plan A, ${SITE_ID}, ${PROFILE_ID}, ${HEIGHT} m, plan B = A + ${SLIP_DAYS} d`);
const rows = (forcedMs === null ? CANDIDATES : [forcedMs]).map(analyse);
for (const r of rows) {
  console.log(
    `${iso(r.landingMs)}: A ${r.aWorks ? 'works' : 'FAILS'} margin ${r2(r.aMarginDays)} d; min clearance ${r2(r.aMinClear.minDeg)} deg at +${r.aMinClear.atHoursAfterLanding} h; ` +
      `at landing ${r2(r.aClearAtLanding)} deg; B ${r.bFails ? 'fails' : 'works'} [${r.bFailures.join(',')}] dark in stay ${r.bDarkInStaySampleHours} h (interp ${r.bDarkInStayInterpHours} h), ` +
      `span ${r.bFullSpan ? r.bFullSpan.days + ' d az ' + r.bFullSpan.azStartDisplay + '..' + r.bFullSpan.azEndDisplay : 'none'}; ` +
      `next ${r.nextLandingMs ? iso(r.nextLandingMs) : 'none'} (+${r.nextDelayDays === null ? 'n/a' : r2(r.nextDelayDays)} d); ${r.passes ? 'PASSES' : 'rejected: ' + r.why.join('; ')}`,
  );
}
const passing = forcedMs === null ? rows.filter((r) => r.passes) : rows;
const candidateTable = rows.map((r) => ({
  planALandingUtc: iso(r.landingMs),
  planAWorks: r.aWorks,
  planASlipMarginDays: r2(r.aMarginDays),
  planAMinSunCentreClearanceDeg: r2(r.aMinClear.minDeg),
  planAMinClearanceAtUtc: r.aMinClear.atUtc,
  planAMinClearanceHoursAfterLanding: r.aMinClear.atHoursAfterLanding,
  planASunClearanceAtLandingDeg: r2(r.aClearAtLanding),
  planBLandingUtc: iso(r.b.landingMs),
  planBFails: r.bFails,
  planBFailureCauses: r.bFailures,
  planBFailsOnSunOnly: r.bSunOnly,
  planBFirstFailureHoursAfterLanding: r.bFirstFailureAfterH === null ? null : r1(r.bFirstFailureAfterH),
  planBDarkHoursInStay: r.bDarkInStaySampleHours,
  planBDarkHoursInStayInterpolated: r.bDarkInStayInterpHours,
  planBDarkSpanDaysInAll: r.bFullSpan?.days ?? null,
  planBBlockingAzimuthDisplayDeg: r.bFullSpan ? [r.bFullSpan.azStartDisplay, r.bFullSpan.azEndDisplay] : null,
  planBTerrainDistKm: r.bFullSpan ? [r.bFullSpan.terrainDistKmMin, r.bFullSpan.terrainDistKmMax] : null,
  nextWorkingLandingUtc: r.nextLandingMs ? iso(r.nextLandingMs) : null,
  nextWorkingDelayDaysAfterPlanB: r.nextDelayDays === null ? null : r2(r.nextDelayDays),
  passesRule: r.passes,
  rejectedBecause: r.why,
}));

if (!passing.length) {
  writeFileSync(join(OUT, 'step1-table.json'), JSON.stringify({ site: SITE_ID, rule: 'no candidate passes', candidates: candidateTable }, null, 1));
  console.error('NO candidate meets the rule; table written to demo-assets/step1-table.json. Nothing else exported.');
  process.exit(2);
}
passing.sort((x, y) => y.aMinClear.minDeg - x.aMinClear.minDeg);
const win = passing[0];
console.log(`WINNER: plan A ${iso(win.landingMs)} (min clearance ${r2(win.aMinClear.minDeg)} deg)`);

// ---- Step 2: geometry in degree units ----
const A = win.a, B = win.b;
const range: YRange = fitRange(
  [A, B].map((p) => ({ geom: p.geom, sunRadiusDeg: p.view.sunRadiusDeg, earthRadiusDeg: p.view.earthRadiusDeg })),
);
const YMIN = range.min, YMAX = range.max;
const COL = { sky: '#0a0c10', line: '#2b2f38', terrain: '#30353f', edge: '#d9dce1', sun: '#ffb020', earth: '#4da3ff', dark: '#3a3f4b', text2: '#a7adb8' };

const svgOpen = (extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-180 ${-YMAX} 360 ${YMAX - YMIN}" width="1080" height="${(YMAX - YMIN) * 3}" preserveAspectRatio="xMidYMid meet"${extra}>`;
// x = azimuth in degrees (-180..180, north 0, east/clockwise to the right); y = -elevation in degrees (up is up).
const pt = (az: number, el: number) => `${f3(az)},${f3(-el)}`;

function terrainGroup(): string {
  const pts: [number, number][] = [];
  for (let d = -180; d <= 180; d += 0.5) pts.push([d, horizonAt(profileArr, mask.azStepDeg, d)]);
  const bottom = YMIN - 1;
  const fill = `M${pt(-180, bottom)} L${pts.map((p) => pt(p[0], p[1])).join(' L')} L${pt(180, bottom)} Z`;
  const edge = `M${pts.map((p) => pt(p[0], p[1])).join(' L')}`;
  return (
    `<g id="terrain" data-units="x azimuth deg, y minus elevation deg" data-sampled-every-deg="0.5">` +
    `<path id="terrain-fill" d="${fill}" fill="${COL.terrain}"/>` +
    `<path id="skyline-edge" d="${edge}" fill="none" stroke="${COL.edge}" stroke-width="1.4" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
    `</g>`
  );
}

function bandGroup(id: string, env: Envelope, radiusDeg: number, colour: string, opacity: number): string {
  // Same construction as bandPaths() in Ribbon.tsx, in degree units.
  const runs: { x: number; lo: number; hi: number }[][] = [];
  let cur: { x: number; lo: number; hi: number }[] = [];
  for (let k = 0; k < 360; k++) {
    const bin = (180 + k) % 360;
    const lo = env.minEl[bin], hi = env.maxEl[bin];
    if (Number.isNaN(lo) || Number.isNaN(hi)) {
      if (cur.length) runs.push(cur);
      cur = [];
      continue;
    }
    const c = bin + 0.5;
    cur.push({ x: c > 180 ? c - 360 : c, lo: lo - radiusDeg, hi: hi + radiusDeg });
  }
  if (cur.length) runs.push(cur);
  const half = 0.5;
  const paths = runs.map((r) => {
    const top = r.map((p, i) => pt(p.x - (i === 0 ? half : 0), p.hi));
    const bot = [...r].reverse().map((p, i) => pt(p.x + (i === 0 ? half : 0), p.lo));
    return `<path d="M${top.join(' L')} L${bot.join(' L')} Z" fill="${colour}" fill-opacity="${opacity}"/>`;
  });
  return `<g id="${id}" data-disc-radius-deg="${r3(radiusDeg)}" data-covers="">${paths.join('')}</g>`;
}

type Pt2 = [number, number];
function sunSegments(p: Plan) {
  const stayEndMs = p.series.startMs + p.view.stayEndIdx * p.series.stepMs;
  type Seg = { pts: Pt2[]; up: boolean; after: boolean };
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  let prev: { x: number; y: number } | null = null;
  for (const q of p.view.sunPath) {
    const up = q.frac >= 0.5;
    const after = q.ms >= stayEndMs;
    const c = { x: displayAz(q.az), y: q.el };
    const wrapped = prev !== null && Math.abs(c.x - prev.x) > 180;
    if (!cur || wrapped || cur.up !== up || cur.after !== after) {
      const keep: Pt2[] = cur && !wrapped && prev ? [[prev.x, prev.y]] : [];
      if (cur && cur.pts.length > 1) segs.push(cur);
      cur = { pts: [...keep, [c.x, c.y]], up, after };
    } else cur.pts.push([c.x, c.y]);
    prev = c;
  }
  if (cur && cur.pts.length > 1) segs.push(cur);
  return segs;
}

function sunPathGroups(p: Plan): string {
  const stayEndMs = p.series.startMs + p.view.stayEndIdx * p.series.stepMs;
  const lines = sunSegments(p).map(
    (sg) =>
      `<polyline points="${sg.pts.map((q) => pt(q[0], q[1])).join(' ')}" fill="none" stroke="${COL.sun}" stroke-width="${sg.up ? 2 : 1.4}" ` +
      `stroke-opacity="${sg.up ? (sg.after ? 0.5 : 1) : 0.55}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" ` +
      `data-state="${sg.up ? 'sun-up' : 'sun-hidden'}" data-phase="${sg.after ? 'after-stay' : 'in-stay'}"/>`,
  );
  const stay: string[] = [], after: string[] = [], nStay: string[] = [], nAfter: string[] = [];
  for (const t of p.view.ticks) {
    const x = displayAz(t.az);
    const inStay = t.ms < stayEndMs;
    const tick =
      `<line x1="${f3(x)}" x2="${f3(x)}" y1="${f3(-(t.el - 0.5))}" y2="${f3(-(t.el + 0.5))}" stroke="${COL.sun}" stroke-width="${inStay ? 1.8 : 1.2}" ` +
      `stroke-opacity="${inStay ? 1 : 0.6}" vector-effect="non-scaling-stroke" data-day="${t.day}" data-az-deg="${r2(wrap360(t.az))}" data-el-deg="${r2(t.el)}" data-utc="${iso(t.ms)}" data-in-stay="${inStay}"/>`;
    (inStay ? stay : after).push(tick);
    if (t.day <= 29) {
      const txt = `<text x="${f3(x)}" y="${f3(-(t.el + 1.1))}" text-anchor="middle" font-size="1.5" fill="${COL.sun}" fill-opacity="${inStay ? 1 : 0.6}" data-day="${t.day}" data-in-stay="${inStay}">${t.day}</text>`;
      (inStay ? nStay : nAfter).push(txt);
    }
  }
  return (
    `<g id="sun-path" data-from="${iso(p.landingMs)}" data-stay-ends="${iso(stayEndMs)}" data-path-ends="${iso(p.series.startMs + p.view.pathEndIdx * p.series.stepMs)}">${lines.join('')}</g>` +
    `<g id="ticks-stay" data-note="one tick per day after landing, inside the stay">${stay.join('')}</g>` +
    `<g id="ticks-after" data-note="day ticks after the stay, to the end of the lunation">${after.join('')}</g>` +
    `<g id="tick-numbers-stay" font-family="sans-serif" data-note="font-size is in degree units">${nStay.join('')}</g>` +
    `<g id="tick-numbers-after" font-family="sans-serif" data-note="font-size is in degree units">${nAfter.join('')}</g>`
  );
}

function earthPathGroup(p: Plan): string {
  const lines: string[] = [];
  let cur: Pt2[] = [];
  let prevX: number | null = null;
  for (const q of p.view.earthPath) {
    const x = displayAz(q.az);
    if (prevX !== null && Math.abs(x - prevX) > 180) {
      if (cur.length > 1) lines.push(cur.map((c) => pt(c[0], c[1])).join(' '));
      cur = [];
    }
    cur.push([x, q.el]);
    prevX = x;
  }
  if (cur.length > 1) lines.push(cur.map((c) => pt(c[0], c[1])).join(' '));
  return (
    `<g id="earth-path" data-from="${iso(p.landingMs)}" data-sampled-every-hours="2">` +
    lines.map((l) => `<polyline points="${l}" fill="none" stroke="${COL.earth}" stroke-width="1" stroke-opacity="0.9" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`).join('') +
    `</g>`
  );
}

interface SpanPiece { x0: number; x1: number; row: number; label: string; after: boolean; id: number; days: number; inStayHours: number }
function spanPieces(p: Plan): SpanPiece[] {
  // Same construction as the dark-span brackets in Ribbon.tsx.
  const s = p.series;
  const stayEndMs = s.startMs + p.view.stayEndIdx * s.stepMs;
  const out: SpanPiece[] = [];
  p.view.spans.forEach((sp, idx) => {
    const i0 = Math.max(0, Math.ceil((sp.startMs - s.startMs) / s.stepMs));
    const i1 = Math.min(s.n - 1, Math.floor((sp.endMs - s.startMs) / s.stepMs));
    const azs: number[] = [sp.azStart];
    for (let i = i0; i <= i1; i++) azs.push(s.sunAz[i]);
    azs.push(sp.azEnd);
    const pieces: number[][] = [];
    let cur: number[] = [];
    azs.forEach((a, i) => {
      const x = displayAz(a);
      if (i > 0 && Math.abs(x - displayAz(azs[i - 1])) > 180) {
        if (cur.length > 1) pieces.push(cur);
        cur = [];
      }
      cur.push(x);
    });
    if (cur.length > 1) pieces.push(cur);
    const xs = pieces.length ? pieces : [[displayAz(sp.azStart)]];
    const inStayH = overlapH(sp, p.landingMs);
    xs.forEach((pc) => {
      out.push({
        x0: Math.min(...pc), x1: Math.max(...pc), row: idx % 2,
        label: spanLabel(inStayH, sp.days), after: sp.startMs >= stayEndMs, id: idx, days: sp.days, inStayHours: inStayH,
      });
    });
  });
  return out;
}

function darkSpansGroup(p: Plan, id = "dark-spans"): string {
  const pieces = spanPieces(p);
  const segs = pieces.map((c) => {
    const el = YMIN + (14 + c.row * 30) / (PLOT_H_PX / (YMAX - YMIN));
    return (
      `<line x1="${f3(c.x0)}" x2="${f3(Math.max(c.x1, c.x0 + 0.3))}" y1="${f3(-el)}" y2="${f3(-el)}" stroke="${COL.text2}" stroke-width="10" stroke-opacity="${c.after ? 0.6 : 1}" ` +
      `vector-effect="non-scaling-stroke" data-span="${c.id}" data-label="${c.label}" data-days="${r2(c.days)}" data-in-stay-hours="${r1(c.inStayHours)}" data-phase="${c.after ? 'after-stay' : 'in-stay'}"/>`
    );
  });
  return `<g id="${id}" data-note="y is a suggested row only; x is the Sun's azimuth range while it is hidden by terrain">${segs.join('')}</g>`;
}

const sky = () => `<rect id="sky" x="-180" y="${-YMAX}" width="360" height="${YMAX - YMIN}" fill="${COL.sky}"/>`;
const bandA = (p: Plan) => bandGroup('sun-band', p.geom.sunBand, p.view.sunRadiusDeg, COL.sun, 0.2).replace(/ data-covers="[^"]*"/, ` data-covers="${iso(p.geom.fromMs)} to ${iso(p.geom.toMs)}"`);
const earthRegionG = (p: Plan) => bandGroup('earth-region', p.geom.earthRegion, p.view.earthRadiusDeg, COL.earth, 0.28).replace(/ data-covers="[^"]*"/, ` data-covers="${iso(p.geom.fromMs)} to ${iso(p.geom.toMs)}"`);

const doc = (title: string, desc: string, body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n${svgOpen()}\n<title>${title}</title>\n<desc>${desc}</desc>\n${body}\n</svg>\n`;
const UNITS = 'x = azimuth in degrees, north 0, east positive to the right, -180..180; y = minus elevation in degrees (up is up); unstretched.';
const siteTxt = `${mask.name}, observer ${HEIGHT} m, short-stay (6.5 days)`;

const files: Record<string, string> = {};
files['skyline.svg'] = doc('Terrain skyline', `${siteTxt}. ${UNITS} Filled area from the skyline down; LOLA 80 m + 240 m terrain.`, terrainGroup());
files['sun-band.svg'] = doc('Sun band', `${siteTxt}. ${UNITS} Plan A series.`, bandA(A));
files['earth-region.svg'] = doc('Earth region', `${siteTxt}. ${UNITS} Plan A series.`, earthRegionG(A));
files['sun-path-A.svg'] = doc('Sun path, plan A', `Plan A, landing ${iso(A.landingMs)}. ${UNITS}`, sunPathGroups(A));
files['sun-path-B.svg'] = doc('Sun path, plan B', `Plan B, landing ${iso(B.landingMs)}. ${UNITS}`, sunPathGroups(B));
files['earth-path-A.svg'] = doc('Earth path, plan A', `Plan A. ${UNITS}`, earthPathGroup(A));
files['earth-path-B.svg'] = doc('Earth path, plan B', `Plan B. ${UNITS}`, earthPathGroup(B));
files['dark-spans.svg'] = doc(
  'Dark spans',
  `Spans where the Sun is hidden by terrain. ${UNITS}`,
  `<g id="plan-A" data-landing="${iso(A.landingMs)}">${darkSpansGroup(A, "dark-spans-A")}</g><g id="plan-B" data-landing="${iso(B.landingMs)}">${darkSpansGroup(B, "dark-spans-B")}</g>`,
);
const allLayers = (p: Plan, tag: string) =>
  doc(
    `All layers, plan ${tag}`,
    `${siteTxt}; plan ${tag}, landing ${iso(p.landingMs)}. ${UNITS} Drawing order, back to front: sky, Sun band, Earth region, Sun path with ticks, Earth path, terrain, dark spans.`,
    sky() + bandA(p) + earthRegionG(p) + sunPathGroups(p) + earthPathGroup(p) + terrainGroup() + darkSpansGroup(p),
  );
files['all-layers-A.svg'] = allLayers(A, 'A');
files['all-layers-B.svg'] = allLayers(B, 'B');
files['all-layers.svg'] = files['all-layers-B.svg'];

// ---- story.json ----
const verdictOf = (p: Plan) => ({ word: p.view.verdict.word, sentences: p.view.verdict.sentences });
const spansOf = (p: Plan) => p.view.spans.map((sp) => describeSpan(p, sp));
function envDiff(x: Envelope, y: Envelope) {
  let mx = 0;
  for (let i = 0; i < 360; i++) {
    for (const k of ['minEl', 'maxEl'] as const) {
      const d = Math.abs(x[k][i] - y[k][i]);
      if (!Number.isNaN(d) && d > mx) mx = d;
    }
  }
  return r3(mx);
}
const stretchAt = (widthPx: number) => r2(PLOT_H_PX / (YMAX - YMIN) / ((Math.max(200, widthPx - PLOT_LEFT - PLOT_RIGHT)) / 360));
const nw = win.nextLandingMs;
const stayEndB = B.landingMs + profile.stayDays * DAY;
const story = {
  generated: new Date().toISOString(),
  command: 'npm run demo-assets',
  site: { id: SITE_ID, name: mask.name, lat: mask.lat, lon: mask.lon, groundElevM: mask.groundElevM, terrain: mask.terrain },
  observerHeightM: HEIGHT,
  profile: { id: profile.id, label: profile.label, stayDays: profile.stayDays, maxDarkGapHours: profile.maxDarkGapHours, minEarthShare: profile.minEarthShare },
  sunUpRule: 'Up = at least half the disc above the skyline = Sun centre at or above the skyline (discFractionAbove >= 0.5; src/engine/visibility.ts, mission.ts threshold 0.5).',
  rule: 'A works; B fails on the Sun only with >= 12 hours dark inside the stay; next working landing >= 20 days after B; then the largest minimum Sun-centre clearance for A.',
  candidates: candidateTable,
  winner: {
    planALandingUtc: iso(A.landingMs),
    planBLandingUtc: iso(B.landingMs),
    slipDays: SLIP_DAYS,
    planA: {
      works: win.aWorks,
      slipMarginDays: r2(win.aMarginDays),
      minSunCentreClearanceDeg: r2(win.aMinClear.minDeg),
      minClearanceAtUtc: win.aMinClear.atUtc,
      minClearanceHoursAfterLanding: win.aMinClear.atHoursAfterLanding,
      sunClearanceAtLandingDeg: r2(win.aClearAtLanding),
      sunAzimuthAtLandingDeg: r1(wrap360(A.series.sunAz[A.view.landingIdx])),
      verdict: verdictOf(A),
      evaluation: A.view.ev,
      darkSpans: spansOf(A),
      sunRateDegPerDay: A.view.sunRateDegPerDay,
    },
    planB: {
      fails: win.bFails,
      failureCauses: win.bFailures,
      firstFailureHoursAfterLanding: win.bFirstFailureAfterH === null ? null : r1(win.bFirstFailureAfterH),
      darkHoursInStay: win.bDarkInStaySampleHours,
      darkHoursInStayInterpolated: win.bDarkInStayInterpHours,
      blockingSpan: win.bFullSpan,
      failureContextFromApp: B.view.ctx,
      verdict: verdictOf(B),
      evaluation: B.view.ev,
      darkSpans: spansOf(B),
      stayEndsUtc: iso(stayEndB),
    },
    nextWorkingLandingUtc: nw ? iso(nw) : null,
    nextWorkingDelayDaysAfterPlanB: win.nextDelayDays === null ? null : r2(win.nextDelayDays),
  },
  svg: {
    units: UNITS,
    viewBox: `-180 ${-YMAX} 360 ${YMAX - YMIN}`,
    elevationRangeDeg: { min: YMIN, max: YMAX, step: range.step, fitted: range.fitted },
    appStretchFormula: `plotH / (max - min) / (plotW / 360), plotH = plot height in px (default ${PLOT_H_PX}; the plan panels size it to the window), plotW = ribbon width - ${PLOT_LEFT + PLOT_RIGHT} px`,
    appStretchAtDefaultPlotHeightAndWidthPx: { 1440: stretchAt(1440), 1200: stretchAt(1200), 1100: stretchAt(1100), 900: stretchAt(900), 390: stretchAt(390) },
    sunBandDiffPlanAvsBMaxDeg: envDiff(A.geom.sunBand, B.geom.sunBand),
    earthRegionDiffPlanAvsBMaxDeg: envDiff(A.geom.earthRegion, B.geom.earthRegion),
    sunDiscRadiusDegPlanA: r3(A.view.sunRadiusDeg), earthDiscRadiusDegPlanA: r3(A.view.earthRadiusDeg),
    seriesPlanA: `${iso(A.geom.fromMs)} to ${iso(A.geom.toMs)}`, seriesPlanB: `${iso(B.geom.fromMs)} to ${iso(B.geom.toMs)}`,
    earthRise: A.geom.earthRise,
    skylineElevationRangeDeg: (() => {
      let lo = Infinity, hi = -Infinity;
      for (let d = -180; d <= 180; d += 0.5) { const e = horizonAt(profileArr, mask.azStepDeg, d); lo = Math.min(lo, e); hi = Math.max(hi, e); }
      return [r2(lo), r2(hi)];
    })(),
  },
};
for (const [name, text] of Object.entries(files)) writeFileSync(join(STORY, name), text);
writeFileSync(join(STORY, 'story.json'), JSON.stringify(story, null, 1) + '\n');

// ---- Step 3: numbers.md ----
const valid = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'validation.json'), 'utf8'));
const trek = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'trek', 'comparison.json'), 'utf8'));
const check = (id: string) => valid.checks.find((c: { id: string }) => c.id === id);
const site = (id: string) => trek.sites.find((s: { id: string }) => s.id === id);
const pct = (x: number) => Math.round(x * 100);
const pct1 = (x: number) => (Math.round(x * 1000) / 10).toFixed(1);
// Verify the PLAN section 6 height and position figures against the repository fixture.
const hp: { label: string; id: string; want: [number, number, number] }[] = [
  { label: 'listed connecting-ridge point', id: 'pgda-site01-connecting-ridge', want: [38, 44, 85] },
  { label: 'listed "peak near Shackleton" point', id: 'pgda-site07-peak-near-shackleton', want: [61, 88, 89] },
  { label: 'listed Malapert point', id: 'pgda-site23-malapert-massif', want: [18, 26, 51] },
];
const hpGot = hp.map((h) => {
  const o = site(h.id).ours;
  const got = [pct(o.h0.sunAny), pct(o.h2.sunAny), pct(o.h10.sunAny)];
  return { ...h, got, match: got.every((g, i) => g === h.want[i]) };
});
const pos: { label: string; listed: string; crest: string; want: [number, number] }[] = [
  { label: 'Shackleton rim', listed: 'pgda-site04-shackleton-rim', crest: 'pgda-site04-shackleton-rim-crest', want: [11, 89] },
  { label: 'Malapert', listed: 'pgda-site23-malapert-massif', crest: 'pgda-site23-malapert-massif-crest', want: [26, 67] },
  { label: 'Leibnitz beta', listed: 'pgda-site20-leibnitz-beta-plateau', crest: 'pgda-site20-leibnitz-beta-plateau-crest', want: [29, 67] },
];
const posGot = pos.map((p) => {
  const got = [pct(site(p.listed).ours.h2.sunAny), pct(site(p.crest).ours.h2.sunAny)];
  return { ...p, got, match: got.every((g, i) => g === p.want[i]) };
});
console.log('PLAN s6 height check:', JSON.stringify(hpGot.map((h) => [h.label, h.got, h.match])));
console.log('PLAN s6 position check:', JSON.stringify(posGot.map((h) => [h.label, h.got, h.match])));
const cmp = trek.comparison;
const mal = site(SITE_ID);

const w = story.winner;
const L: string[] = [];
L.push('# Numbers allowed on a slide', '');
L.push('Every figure below has a source. Do not put any other number on a slide. Regenerate with `npm run demo-assets`.', '');
L.push('## (a) The opening story', '');
L.push(`Source for every row in this section: \`npm run demo-assets\` (\`pipeline/export-demo-assets.ts\`; full detail in \`demo-assets/story/story.json\`). Site: ${mask.name}, listed point (${mask.lat}, ${mask.lon}), observer ${HEIGHT} m, profile short-stay (6.5-day stay, continuous sunlight, Earth in view). Plan B = plan A + ${SLIP_DAYS} days. "Sun up" means the Sun's centre is above the skyline (at least half the disc).`, '');
L.push('| Figure | Value |', '|---|---|');
const row = (k: string, v: string) => L.push(`| ${k} | ${v} |`);
row('Plan A landing', w.planALandingUtc);
row('Plan A verdict', w.planA.works ? 'works' : 'fails');
row('Plan A slip margin', `${w.planA.slipMarginDays} days`);
row('Plan A minimum Sun-centre clearance above the skyline during the stay', `${w.planA.minSunCentreClearanceDeg} deg, at ${w.planA.minClearanceAtUtc} (${w.planA.minClearanceHoursAfterLanding} h after landing)`);
row('Plan A Sun clearance at landing', `${w.planA.sunClearanceAtLandingDeg} deg`);
row('Plan A longest dark span in the lunation', `${Math.max(...w.planA.darkSpans.map((s) => s.days))} days`);
row('Plan B landing', w.planBLandingUtc);
row('Plan B verdict', `fails on: ${w.planB.failureCauses.join(', ')}`);
row('Plan B first failure', `${w.planB.firstFailureHoursAfterLanding} h after landing (${r2((w.planB.firstFailureHoursAfterLanding ?? 0) / 24)} days)`);
if (win.bFullSpan) {
  const s = win.bFullSpan;
  row('Plan B Sun hidden inside the stay', `${w.planB.darkHoursInStay} h counted hourly (${s.inStayHours} h interpolated)`);
  row('Plan B dark span in all', `${s.days} days (${s.startUtc} to ${s.endUtc})`);
  row('Plan B blocking azimuth', `${s.azStartDeg} to ${s.azEndDeg} deg clockwise from north (${s.azStartDisplay} to ${s.azEndDisplay} on the ribbon axis), ${s.azMidCompass}`);
  row('Plan B terrain distance to the blocking skyline', `${s.terrainDistKmMin} to ${s.terrainDistKmMax} km`);
  row('Plan B skyline elevation over the blocking azimuths', `${s.skylineElDegMin} to ${s.skylineElDegMax} deg`);
  row('Plan B Sun elevation while hidden', `${s.sunElDegMin} to ${s.sunElDegMax} deg (above the local horizontal ${Math.round(s.shareOfSpanSunAboveLocalHorizontal * 100)}% of the hidden span, so terrain is the blocker)`);
}
row('Next working landing after plan B', `${w.nextWorkingLandingUtc} (${w.nextWorkingDelayDaysAfterPlanB} days after plan B)`);
row('Opening-story slip', `${SLIP_DAYS} days`);
row('Vertical stretch the app shows under the ribbon (1200 px wide, default plot height)', `x${story.svg.appStretchAtDefaultPlotHeightAndWidthPx[1200]} (elevation range ${YMIN} to ${YMAX} deg)`);
L.push('', 'Candidate landing times examined (the rule that chose plan A is in `story.json`):', '');
L.push('| Plan A landing | A works | A margin d | A min clearance deg (+h) | clearance at landing deg | B fails on | B dark h in stay | B span days | B azimuth (ribbon axis) | terrain km | next window | delay d | rule |');
L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of candidateTable) {
  L.push(`| ${c.planALandingUtc} | ${c.planAWorks} | ${c.planASlipMarginDays} | ${c.planAMinSunCentreClearanceDeg} (+${c.planAMinClearanceHoursAfterLanding}) | ${c.planASunClearanceAtLandingDeg} | ${c.planBFailureCauses.join(',') || 'works'} | ${c.planBDarkHoursInStay} | ${c.planBDarkSpanDaysInAll ?? ''} | ${c.planBBlockingAzimuthDisplayDeg ? c.planBBlockingAzimuthDisplayDeg.join(' to ') : ''} | ${c.planBTerrainDistKm ? c.planBTerrainDistKm.join(' to ') : ''} | ${c.nextWorkingLandingUtc ?? ''} | ${c.nextWorkingDelayDaysAfterPlanB ?? ''} | ${c.passesRule ? 'passes' : 'rejected'} |`);
}

L.push('', '## (b) Figures from PLAN section 6', '');
L.push('Wording copied from `docs/PLAN.md` section 6. "Repository source" is the file that produces the number; "PLAN §6" means no repository file prints it directly.', '');
L.push('| Figure (PLAN §6) | Repository source |', '|---|---|');
L.push(`| Sun and Earth directions: against JPL Horizons, six site-and-period cases, 6,610 rows per body: largest difference 0.0078° for the Sun and 0.0034° for Earth. | \`src/data/validation.json\` check \`ephemeris-horizons\` (${check('ephemeris-horizons').result}); \`tests/ephemeris.test.ts\` with \`tests/fixtures/horizons/\`. validation.json counts 13,220 rows in all, two bodies. |`);
L.push(`| Terrain read correctly: ground heights at five NASA Goddard study sites against NASA Moon Trek: largest difference 16 m. A second comparison over 21 sites: median difference 1.5 m. | \`src/data/validation.json\` check \`terrain-grid-read\`; \`tests/fixtures/trek/comparison.json\` key \`demCheck\` (n ${trek.demCheck.n}, median ${trek.demCheck.medianAbsDiffM} m, largest ${r1(trek.demCheck.maxAbsDiffM)} m). |`);
L.push(`| Skylines against NASA Goddard's average-visibility maps, 23 sites, observer on the ground, share of time with any part of the disc in view. Sun: correlation 0.975, median difference 1.35 points, mean bias +2.0 points, largest disagreement 18% against 5% at the listed Malapert point. | \`tests/fixtures/trek/comparison.json\` key \`comparison.sun_h0_Any\` (pearson ${r3(cmp.sun_h0_Any.pearson)}, median ${r2(cmp.sun_h0_Any.medianAbsDiffPp)} points, mean ${r2(cmp.sun_h0_Any.meanDiffPp)} points, worst site ${cmp.sun_h0_Any.worstSite} at ${r1(cmp.sun_h0_Any.worstDiffPp)} points); \`src/data/validation.json\` check \`average-sunlight\` rounds the same data to 0.98 and 1.3. |`);
L.push(`| Earth: correlation 0.995, median difference 0.25 points, mean bias +0.1 points, largest disagreement 40% against 53.5% at the ridge point. | \`tests/fixtures/trek/comparison.json\` key \`comparison.earth_h0_Any\` (pearson ${r3(cmp.earth_h0_Any.pearson)}, median ${r2(cmp.earth_h0_Any.medianAbsDiffPp)}, mean ${r2(cmp.earth_h0_Any.meanDiffPp)}, worst site ${cmp.earth_h0_Any.worstSite} at ${r1(cmp.earth_h0_Any.worstDiffPp)} points); \`src/data/validation.json\` check \`average-earth\` rounds to 1.00 and 0.3. |`);
L.push(`| Real missions: IM-1: Sun's centre on the smooth horizon 2024-03-03 08:11 UTC; Horizons gives +0.6° at 00:00 that day and −1.5° a day later. Blue Ghost 1: sunset 347.8 hours after landing, against about 346 hours reported. | \`src/data/validation.json\` checks \`mission-im1\` (${check('mission-im1').result}) and \`mission-blue-ghost-1\` (${check('mission-blue-ghost-1').result}). |`);
L.push('| The pole in 2027: Sun\'s centre stays between −1.55° and +1.55°; it moves 12.19° per day, always right to left. Earth\'s centre ranges from −7.1° to +6.6°. | PLAN §6 (inputs: `tests/fixtures/horizons/pole-2027.json`). |');
const hRow = (h: (typeof hpGot)[number]) => `${h.label} ${h.want[0]}%, ${h.want[1]}%, ${h.want[2]}%`;
L.push(`| Height matters (long-term share of time with the Sun in view, at ground level, 2 m, 10 m): ${hpGot.map(hRow).join('; ')}. | \`tests/fixtures/trek/comparison.json\` \`sites[].ours.h0 / h2 / h10 .sunAny\` for \`pgda-site01-connecting-ridge\`, \`pgda-site07-peak-near-shackleton\`, \`pgda-site23-malapert-massif\`. Check run by this script: ${hpGot.every((h) => h.match) ? 'all nine figures match the fixture when rounded' : 'MISMATCH, see ' + JSON.stringify(hpGot.filter((h) => !h.match).map((h) => [h.label, h.got]))}. |`);
const pRow = (p: (typeof posGot)[number]) => `${p.label} ${p.want[0]}% against ${p.want[1]}%`;
L.push(`| Position matters (same measure at 2 m, listed point against the highest point within 8 km): ${posGot.map(pRow).join('; ')}. | \`tests/fixtures/trek/comparison.json\` \`sites[].ours.h2.sunAny\`, listed site against its \`-crest\` site. Check run by this script: ${posGot.every((p) => p.match) ? 'all six figures match the fixture when rounded' : 'MISMATCH, see ' + JSON.stringify(posGot.filter((p) => !p.match).map((p) => [p.label, p.got]))}. |`);
L.push('| Speed: the landing-date scan over two years takes about 0.2 ms (measured on synthetic data). | PLAN §6 (measurement printed by `tests/mission.test.ts`, check 4). |');

L.push('', '## (c) Malapert listed point against NASA Goddard\'s map', '');
L.push('The opening story is set at the one site where our Sun figure disagrees most with NASA Goddard\'s map. State this plainly wherever the figure appears.', '');
L.push('| Figure | Value | Source |', '|---|---|---|');
L.push(`| Our share of time with any part of the Sun's disc above the skyline, observer on the ground (0 m) | ${pct1(mal.ours.h0.sunAny)}% | \`tests/fixtures/trek/comparison.json\` sites[${SITE_ID}].ours.h0.sunAny; \`src/data/validation.json\` check \`average-sunlight\` ("ours 18.2%") |`);
L.push(`| NASA Goddard map, same site and quantity | ${pct1(mal.nasa.sun.value)}% | comparison.json sites[${SITE_ID}].nasa.sun.value (service ${mal.nasa.sun.service}, ${mal.nasa.sun.pixelM} m pixels); validation.json ("NASA 4.6%") |`);
L.push(`| Difference | +${r1(cmp.sun_h0_Any.worstDiffPp)} points (ours minus NASA); the largest of the 23 sites | comparison.json comparison.sun_h0_Any.worstDiffPp; validation.json ("+13.6 points") |`);
L.push(`| Our share at the story's observer height (2 m), shipped mask | ${pct1(mal.ours.h2.sunAny)}% (10 m: ${pct1(mal.ours.h10.sunAny)}%) | comparison.json sites[${SITE_ID}].ours.h2.sunAny / h10.sunAny. NASA's maps are ground level only, so there is no NASA figure at 2 m. |`);
L.push(`| Agreement across all 23 sites, Sun, ground level | correlation ${r3(cmp.sun_h0_Any.pearson)}, median difference ${r2(cmp.sun_h0_Any.medianAbsDiffPp)} points, mean +${r1(cmp.sun_h0_Any.meanDiffPp)} points | comparison.json comparison.sun_h0_Any (PLAN §6) |`);
L.push(`| Earth at the same site, ground level | ours ${pct1(mal.ours.h0.earthAny)}%, NASA ${pct1(mal.nasa.earth.value)}% | comparison.json sites[${SITE_ID}].ours.h0.earthAny / nasa.earth.value |`);
L.push('', `Why the Sun figure differs here (from \`src/data/validation.json\`, check \`average-sunlight\`): NASA's maps are on a 60 m to 240 m grid, contain linear artefacts from the elevation model, and our 80 m grid cannot see relief smaller than about 80 m; the listed Malapert coordinates are rounded, and at ridge crests a 100 m shift changes the skyline by degrees. Status in validation.json: "note", not "pass".`);
writeFileSync(join(OUT, 'numbers' + TAG + '.md'), L.join('\n') + '\n');
console.log('done');

// ---- Data for the demo deck (public/deck/) ----
// The deck draws its ribbon from these numbers, so every shape on a slide is the app's own geometry.
// Written only for the rule's winner, never for a --landing variant.
if (forcedMs === null) {
  const bandRuns = (env: Envelope, radiusDeg: number) => {
    const runs: number[][][] = [];
    let cur: number[][] = [];
    for (let k = 0; k < 360; k++) {
      const bin = (180 + k) % 360;
      const lo = env.minEl[bin], hi = env.maxEl[bin];
      if (Number.isNaN(lo) || Number.isNaN(hi)) {
        if (cur.length) runs.push(cur);
        cur = [];
        continue;
      }
      const c = bin + 0.5;
      cur.push([c > 180 ? c - 360 : c, r3(lo - radiusDeg), r3(hi + radiusDeg)]);
    }
    if (cur.length) runs.push(cur);
    return runs;
  };
  const planData = (p: Plan) => {
    const stayEndMs = p.series.startMs + p.view.stayEndIdx * p.series.stepMs;
    const h = (ms: number) => r2((ms - p.landingMs) / HOUR);
    return {
      landingUtc: iso(p.landingMs),
      landingMs: p.landingMs,
      stayEndHours: h(stayEndMs),
      // [hours after landing, ribbon azimuth, elevation, fraction of the disc above the skyline]
      sun: p.view.sunPath.map((q) => [h(q.ms), r3(displayAz(q.az)), r3(q.el), r2(q.frac)]),
      earth: p.view.earthPath.map((q) => [h(q.ms), r3(displayAz(q.az)), r3(q.el), r2(q.frac)]),
      ticks: p.view.ticks.map((t) => [t.day, r3(displayAz(t.az)), r3(t.el)]),
      spans: spanPieces(p).map((c) => ({ x0: r3(c.x0), x1: r3(c.x1), id: c.id, days: r2(c.days), inStayHours: r1(c.inStayHours), afterStay: c.after, label: c.label })),
      verdict: verdictOf(p),
    };
  };
  const skyline: number[] = [];
  for (let d = -180; d <= 180; d += 0.5) skyline.push(r3(horizonAt(profileArr, mask.azStepDeg, d)));
  const deck = {
    generatedBy: 'npm run demo-assets (pipeline/export-demo-assets.ts), from src/engine and src/state; do not edit by hand',
    site: { id: SITE_ID, name: mask.name, lat: mask.lat, lon: mask.lon, observerHeightM: HEIGHT, profile: profile.label },
    elevationRangeDeg: [YMIN, YMAX],
    skylineStepDeg: 0.5,
    skyline,
    sunRadiusDeg: r3(A.view.sunRadiusDeg),
    earthRadiusDeg: r3(A.view.earthRadiusDeg),
    sunBand: bandRuns(A.geom.sunBand, A.view.sunRadiusDeg),
    earthRegion: bandRuns(A.geom.earthRegion, A.view.earthRadiusDeg),
    slipDays: SLIP_DAYS,
    A: planData(A),
    B: planData(B),
    next: nw ? { landingUtc: iso(nw), landingMs: nw, daysAfterB: r2((nw - B.landingMs) / DAY) } : null,
  };
  const deckDir = join(ROOT, 'public', 'deck');
  mkdirSync(deckDir, { recursive: true });
  writeFileSync(join(deckDir, 'ribbon-data.js'), '// ' + deck.generatedBy + '\nwindow.RIBBON_DATA = ' + JSON.stringify(deck) + ';\n');
  console.log('deck data: public/deck/ribbon-data.js');
}
