// Search for the opening scenario: a landing time that works but fails if it slips a few days.
// Run: node pipeline/find-stories.ts     Output: pipeline/out/stories.md and pipeline/out/stories.json
// Not shipped in the app. The engine files import each other without the .ts extension, so this
// registers the same tiny resolve hook as pipeline/validate-illumination.ts.

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
const { PROFILES, evaluate, slipScan, nextWindow, slipMarginMs } = await import('../src/engine/mission.ts');
type HorizonMask = import('../src/engine/horizon.ts').HorizonMask;
type SiteSeries = import('../src/engine/visibility.ts').SiteSeries;
type MissionProfile = import('../src/engine/mission.ts').MissionProfile;
type SlipScan = import('../src/engine/mission.ts').SlipScan;

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'pipeline', 'out');
mkdirSync(OUT, { recursive: true });

const HOUR = 3600000;
const DAY = 86400000;
const START = Date.UTC(2027, 0, 1);
const END_SERIES = Date.UTC(2029, 4, 1); // exclusive: series covers through 2029-04-30
const LAND_END = Date.UTC(2029, 0, 1); // landing times up to 2028-12-31 (exclusive end)
const N_HOURS = (END_SERIES - START) / HOUR;
const STRIDE = 6; // hours
const PER_DAY = 24 / STRIDE;
const HEIGHTS = [2, 10];
const KLIMIT = (LAND_END - START) / (STRIDE * HOUR); // landing candidates are k in [0, KLIMIT)

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z';
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const POINTS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (az: number) => POINTS16[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
const CAUSE = ['ok', 'sun', 'earth', 'sun+earth'];

// ---- Masks ----
const index: any[] = JSON.parse(readFileSync(join(ROOT, 'public', 'masks', 'index.json'), 'utf8'));
const masks: HorizonMask[] = [];
for (const e of index) {
  if (!String(e.terrain).startsWith('lola-80m')) continue;
  masks.push(JSON.parse(readFileSync(join(ROOT, 'public', 'masks', `${e.id}.json`), 'utf8')));
}
console.log(`masks with lola-80m terrain: ${masks.length}`);

const frames = new FrameCache();

interface Combo {
  site: string;
  profile: string;
  height: number;
  scan: SlipScan;
  series: SiteSeries;
}
const skipped: { id: string; reason: string }[] = [];
const combos = new Map<string, Combo>();
const comboKey = (site: string, profile: string, h: number) => `${site}|${profile}|${h}`;
const seriesOf = new Map<string, SiteSeries>();
const maskById = new Map<string, HorizonMask>();

for (const m of masks) {
  maskById.set(m.id, m);
  for (const h of HEIGHTS) {
    if (!m.horizonDeg[String(h)]) { skipped.push({ id: `${m.id}@${h}m`, reason: 'no skyline for this height' }); continue; }
    const s = computeSeries(m, h, START, HOUR, N_HOURS, frames);
    let up = 0;
    for (let i = 0; i < s.n; i++) if (s.sunFrac[i] >= 0.5) up++;
    if (up === 0) { skipped.push({ id: `${m.id}@${h}m`, reason: 'Sun never above the skyline in the series' }); continue; }
    seriesOf.set(`${m.id}|${h}`, s);
    for (const p of PROFILES) {
      combos.set(comboKey(m.id, p.id, h), { site: m.id, profile: p.id, height: h, scan: slipScan(s, p, 0, N_HOURS, STRIDE), series: s });
    }
  }
}
console.log(`combos: ${combos.size}, skipped: ${skipped.length}`);

// ---- Per-combo statistics ----
const okAt = (c: Combo, k: number) => c.scan.code[k] === 0;
function windows(c: Combo): number[] {
  const out: number[] = [];
  let run = 0;
  const lim = Math.min(KLIMIT, c.scan.n);
  for (let k = 0; k < lim; k++) {
    if (okAt(c, k)) run++;
    else if (run) { out.push(run / PER_DAY); run = 0; }
  }
  if (run) out.push(run / PER_DAY);
  return out;
}
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

interface ComboStat {
  site: string; profile: string; height: number;
  candidates: number; okShare: number;
  windows: { count: number; medianDays: number; longestDays: number };
  slipGroups: SlipGroup[];
}
interface SlipGroup {
  cause: string;
  firstFailN: number[]; // distinct first-failing N in the group
  count: number;
  fromL: string; toL: string;
  nextWindowStart: string | null;
  best: Candidate;
}
interface Candidate {
  site: string; profile: string; height: number;
  landingMs: number; landing: string;
  marginDays: number;
  slipN: number; planB: string;
  cause: string;
  nextWindowDays: number | null; nextWindowStart: string | null;
  // ranking flags
  a: number; b: number; c: number; d: number; e: number;
  eval?: any;
}

const stats: ComboStat[] = [];
const allBest: Candidate[] = [];
const PRIORITY_SITES = ['pgda-site01-', 'pgda-site23-', 'pgda-site20-'];
const roundDom = (ms: number) => [1, 5, 10, 15, 20, 25].includes(new Date(ms).getUTCDate());

for (const c of combos.values()) {
  const lim = Math.min(KLIMIT, c.scan.n);
  let ok = 0;
  for (let k = 0; k < lim; k++) if (okAt(c, k)) ok++;
  const w = windows(c);
  const groups = new Map<string, { members: Candidate[]; ns: Set<number>; cause: string; win: string | null }>();
  for (let k = 0; k < lim; k++) {
    if (!okAt(c, k)) continue;
    let nFirst = 0;
    for (let n = 1; n <= 14; n++) {
      const kk = k + n * PER_DAY;
      if (kk >= c.scan.n) break;
      if (c.scan.code[kk] !== 0) { nFirst = n; break; }
    }
    if (!nFirst) continue;
    const kb = k + nFirst * PER_DAY;
    const code = c.scan.code[kb];
    const Lms = c.scan.startMs + k * c.scan.stepMs;
    const Bms = Lms + nFirst * DAY;
    const nw = nextWindow(c.scan, Bms);
    const nwDays = nw ? (nw.startMs - Bms) / DAY : null;
    const margin = slipMarginMs(c.scan, Lms) / DAY;
    const cand: Candidate = {
      site: c.site, profile: c.profile, height: c.height,
      landingMs: Lms, landing: iso(Lms), marginDays: r2(margin),
      slipN: nFirst, planB: iso(Bms), cause: CAUSE[code],
      nextWindowDays: nwDays === null ? null : r2(nwDays), nextWindowStart: nw ? iso(nw.startMs) : null,
      a: margin >= 2 && margin <= 8 ? 1 : 0,
      b: code === 1 || code === 2 ? 1 : 0,
      c: nwDays !== null && nwDays >= 14 && nwDays < 200 ? 1 : 0,
      d: PRIORITY_SITES.some((p) => c.site.startsWith(p)) ? 1 : 0,
      e: (c.profile === 'lunar-day' || c.profile === 'short-stay') && new Date(Lms).getUTCHours() === 0 ? 1 : 0,
    };
    const key = `${code}|${nw ? nw.startMs : 'none'}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { members: [], ns: new Set(), cause: CAUSE[code], win: nw ? iso(nw.startMs) : null }));
    g.members.push(cand);
    g.ns.add(nFirst);
  }
  const slipGroups: SlipGroup[] = [];
  for (const g of groups.values()) {
    const pref = (x: Candidate) => [x.a, roundDom(x.landingMs) && new Date(x.landingMs).getUTCHours() === 0 ? 1 : 0, new Date(x.landingMs).getUTCHours() === 0 ? 1 : 0, -Math.abs(x.marginDays - 5)];
    let best = g.members[0];
    for (const m of g.members) {
      const pa = pref(best), pb = pref(m);
      for (let i = 0; i < pa.length; i++) {
        if (pb[i] > pa[i]) { best = m; break; }
        if (pb[i] < pa[i]) break;
      }
    }
    slipGroups.push({
      cause: g.cause, firstFailN: [...g.ns].sort((x, y) => x - y), count: g.members.length,
      fromL: g.members[0].landing, toL: g.members[g.members.length - 1].landing,
      nextWindowStart: g.win, best,
    });
    allBest.push(best);
  }
  stats.push({
    site: c.site, profile: c.profile, height: c.height,
    candidates: lim, okShare: r2(ok / lim),
    windows: { count: w.length, medianDays: r2(median(w)), longestDays: r2(w.length ? Math.max(...w) : 0) },
    slipGroups,
  });
}

// ---- Ranking ----
function cmpCandidate(x: Candidate, y: Candidate): number {
  for (const f of ['a', 'b', 'c', 'd', 'e'] as const) if (x[f] !== y[f]) return y[f] - x[f];
  const wx = x.c ? x.nextWindowDays! : -1, wy = y.c ? y.nextWindowDays! : -1;
  if (wx !== wy) return wy - wx;
  const hx = new Date(x.landingMs).getUTCHours() === 0 ? 1 : 0, hy = new Date(y.landingMs).getUTCHours() === 0 ? 1 : 0;
  if (hx !== hy) return hy - hx;
  return Math.abs(x.marginDays - 5) - Math.abs(y.marginDays - 5);
}
allBest.sort(cmpCandidate);
// One candidate per site/profile/height, then the top 10.
const seen = new Set<string>();
const top: Candidate[] = [];
for (const c of allBest) {
  const k = `${c.site}|${c.profile}|${c.height}`;
  if (seen.has(k)) continue;
  seen.add(k);
  top.push(c);
  if (top.length === 10) break;
}

// ---- Viewer details ----
function runsBelow(frac: Float32Array, a: number, b: number): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  for (let i = a; i < b; i++) {
    if (frac[i] < 0.5) { if (s < 0) s = i; } else if (s >= 0) { out.push([s, i]); s = -1; }
  }
  if (s >= 0) out.push([s, b]);
  return out;
}
function bodyDetail(series: SiteSeries, mask: HorizonMask, h: number, body: 'sun' | 'earth', LB: number, stayH: number) {
  const frac = body === 'sun' ? series.sunFrac : series.earthFrac;
  const az = body === 'sun' ? series.sunAz : series.earthAz;
  const el = body === 'sun' ? series.sunEl : series.earthEl;
  const hor = body === 'sun' ? series.sunHorizon : series.earthHorizon;
  const end = Math.min(series.n, LB + stayH);
  const runs = runsBelow(frac, LB, end);
  let downH = 0;
  for (const [a, b] of runs) downH += b - a;
  if (!runs.length) return { body, none: true };
  runs.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
  const [a, b] = runs[0];
  let u = az[a], uMin = u, uMax = u;
  for (let i = a + 1; i < b; i++) {
    let d = az[i] - az[i - 1];
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    u += d;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
  }
  let hMin = Infinity, hMax = -Infinity, eMin = Infinity, eMax = -Infinity, above0 = 0;
  let dMin = Infinity, dMax = -Infinity;
  const dist = mask.distKm?.[String(h)];
  for (let i = a; i < b; i++) {
    hMin = Math.min(hMin, hor[i]); hMax = Math.max(hMax, hor[i]);
    eMin = Math.min(eMin, el[i]); eMax = Math.max(eMax, el[i]);
    if (el[i] > 0) above0++;
    if (dist) {
      const idx = Math.round((((az[i] % 360) + 360) % 360) / mask.azStepDeg) % dist.length;
      dMin = Math.min(dMin, dist[idx]); dMax = Math.max(dMax, dist[idx]);
    }
  }
  const mid = Math.floor((a + b - 1) / 2);
  const wrap = (x: number) => ((x % 360) + 360) % 360;
  return {
    body,
    totalDownHoursInStay: downH, totalDownShareOfStay: r2(downH / (end - LB)),
    longestRun: {
      startUtc: iso(series.startMs + a * HOUR), endUtc: iso(series.startMs + b * HOUR),
      startsHoursAfterLanding: a - LB, lengthDays: r2((b - a) / 24),
      azFromDeg: r1(wrap(az[a])), azToDeg: r1(wrap(az[b - 1])),
      azSweepDeg: r1(uMax - uMin), azMidDeg: r1(wrap(az[mid])), azMidCompass: compass(az[mid]),
      skylineElDegMin: r2(hMin), skylineElDegMax: r2(hMax),
      bodyElDegMin: r2(eMin), bodyElDegMax: r2(eMax),
      shareOfRunBodyAboveFlatHorizon: r2(above0 / (b - a)),
      terrainDistKmMin: dist ? r1(dMin) : null, terrainDistKmMax: dist ? r1(dMax) : null,
    },
  };
}
const profileById = (id: string) => PROFILES.find((p: MissionProfile) => p.id === id)!;
for (const c of top.slice(0, 10)) {
  const series = seriesOf.get(`${c.site}|${c.height}`)!;
  const p = profileById(c.profile);
  const iA = (c.landingMs - START) / HOUR;
  const iB = iA + c.slipN * 24;
  const ea = evaluate(series, iA, p);
  const eb = evaluate(series, iB, p);
  c.eval = { planA: ea, planB: eb };
  const stayH = Math.round(p.stayDays * 24);
  const mask = maskById.get(c.site)!;
  const det: any[] = [];
  if (eb.failures.some((f: string) => f === 'dark-gap' || f === 'sun-down-at-landing')) det.push(bodyDetail(series, mask, c.height, 'sun', iB, stayH));
  if (eb.failures.some((f: string) => f === 'earth-share' || f === 'earth-down-at-landing')) det.push(bodyDetail(series, mask, c.height, 'earth', iB, stayH));
  (c.eval as any).viewer = det;
}

// ---- Position pairs and height pairs ----
interface PairResult {
  kind: string; site: string; other: string; profile: string; height: number | string;
  shareA: number; shareB: number; aOnlyCount: number; bOnlyCount: number;
  longestAonly?: any; longestBonly?: any;
}
function longestRun(ca: Combo, cb: Combo, pred: (a: boolean, b: boolean) => boolean) {
  const lim = Math.min(KLIMIT, ca.scan.n, cb.scan.n);
  let best = { len: 0, start: -1 }, cur = 0, st = -1;
  for (let k = 0; k <= lim; k++) {
    const hit = k < lim && pred(okAt(ca, k), okAt(cb, k));
    if (hit) { if (cur === 0) st = k; cur++; }
    else { if (cur > best.len) best = { len: cur, start: st }; cur = 0; }
  }
  if (!best.len) return null;
  const k0 = best.start;
  const Lms = ca.scan.startMs + k0 * ca.scan.stepMs;
  return {
    startUtc: iso(Lms), endUtc: iso(Lms + (best.len - 1) * ca.scan.stepMs), days: r2(best.len / PER_DAY),
    codeA: CAUSE[ca.scan.code[k0]], codeB: CAUSE[cb.scan.code[k0]],
  };
}
function shareOf(c: Combo) {
  const lim = Math.min(KLIMIT, c.scan.n);
  let ok = 0;
  for (let k = 0; k < lim; k++) if (okAt(c, k)) ok++;
  return ok / lim;
}
function pairStats(kind: string, a: Combo, b: Combo, site: string, other: string, profile: string, height: number | string): PairResult {
  const lim = Math.min(KLIMIT, a.scan.n, b.scan.n);
  let ao = 0, bo = 0;
  for (let k = 0; k < lim; k++) {
    const x = okAt(a, k), y = okAt(b, k);
    if (x && !y) ao++;
    if (!x && y) bo++;
  }
  return {
    kind, site, other, profile, height,
    shareA: r2(shareOf(a)), shareB: r2(shareOf(b)), aOnlyCount: ao, bOnlyCount: bo,
    longestAonly: longestRun(a, b, (x, y) => x && !y), longestBonly: longestRun(a, b, (x, y) => !x && y),
  };
}
const positionPairs: PairResult[] = [];
const heightPairs: PairResult[] = [];
for (const m of masks) {
  if (!m.id.startsWith('pgda-site') || m.id.endsWith('-crest')) continue;
  const crest = `${m.id}-crest`;
  for (const p of PROFILES) {
    for (const h of HEIGHTS) {
      const a = combos.get(comboKey(m.id, p.id, h)), b = combos.get(comboKey(crest, p.id, h));
      if (a && b) positionPairs.push(pairStats('position (listed point vs crest)', a, b, m.id, crest, p.id, h));
    }
  }
}
for (const m of masks) {
  for (const p of PROFILES) {
    const lo = combos.get(comboKey(m.id, p.id, 2)), hi = combos.get(comboKey(m.id, p.id, 10));
    if (lo && hi) heightPairs.push(pairStats('height (2 m = A, 10 m = B)', lo, hi, m.id, m.id, p.id, '2 vs 10'));
  }
}
const bestPos = [...positionPairs].sort((x, y) => (y.longestAonly?.days ?? 0) + (y.longestBonly?.days ?? 0) - ((x.longestAonly?.days ?? 0) + (x.longestBonly?.days ?? 0)));
const bestHgt = [...heightPairs].sort((x, y) => (y.longestBonly?.days ?? 0) - (x.longestBonly?.days ?? 0));

// ---- Write ----
const lunarDay2 = stats.filter((s) => s.profile === 'lunar-day' && s.height === 2).sort((a, b) => b.okShare - a.okShare);
writeFileSync(join(OUT, 'stories.json'), JSON.stringify({
  generated: new Date().toISOString(),
  setup: { series: '2027-01-01 to 2029-04-30 hourly', landings: '2027-01-01 to 2028-12-31, 6 h stride', heights: HEIGHTS, profiles: PROFILES.map((p: MissionProfile) => p.id) },
  skipped, comboStats: stats, top10: top, positionPairs, heightPairs,
}, null, 1));

const L: string[] = [];
L.push('# Opening-scenario search results', '');
L.push('Series 2027-01-01..2029-04-30 hourly; landings every 6 h 2027-01-01..2028-12-31; observer heights 2 m and 10 m.');
L.push('Rule flags: a = margin 2-8 d, b = single cause, c = next window 14-200 d, d = priority site, e = lunar-day/short-stay at 00:00 UTC.', '');
L.push('## Top 10 slip cases', '');
top.forEach((c, i) => {
  const ea = c.eval.planA, eb = c.eval.planB;
  L.push(`### ${i + 1}. ${c.site} / ${c.profile} / ${c.height} m`);
  L.push(`- Flags a${c.a} b${c.b} c${c.c} d${c.d} e${c.e}`);
  L.push(`- Plan A landing ${c.landing}; slip margin ${c.marginDays} d; Sun share ${r2(ea.sunShare)}, Earth share ${r2(ea.earthShare)}; first sunset ${ea.firstSunsetAfterH === null ? 'none in stay' : r1(ea.firstSunsetAfterH) + ' h'}, first Earthset ${ea.firstEarthsetAfterH === null ? 'none in stay' : r1(ea.firstEarthsetAfterH) + ' h'}`);
  L.push(`- Plan B landing ${c.planB} (slip ${c.slipN} d); fails: ${eb.failures.join(', ')}; first failure ${eb.firstFailureAfterH === null ? 'n/a' : r1(eb.firstFailureAfterH) + ' h after landing'}; Sun share ${r2(eb.sunShare)}, Earth share ${r2(eb.earthShare)}; longest dark gap ${r1(eb.longestDarkGapH)} h; longest Earth gap ${r1(eb.longestEarthGapH)} h`);
  L.push(`- Cause (scan) ${c.cause}; next working window starts ${c.nextWindowStart ?? 'none in scan'}, ${c.nextWindowDays ?? 'n/a'} d after plan B`);
  {
    for (const d of c.eval.viewer) {
      if (d.none) { L.push(`- Viewer (${d.body}): no run below the skyline`); continue; }
      const r = d.longestRun;
      L.push(`- Viewer (${d.body}) hidden: ${r.startUtc} to ${r.endUtc} (${r.lengthDays} d, starts ${r.startsHoursAfterLanding} h after landing; ${d.totalDownHoursInStay} h down in all, ${d.totalDownShareOfStay} of stay); azimuth ${r.azFromDeg} to ${r.azToDeg} deg (sweep ${r.azSweepDeg}, mid ${r.azMidDeg} = ${r.azMidCompass}); skyline ${r.skylineElDegMin} to ${r.skylineElDegMax} deg; ${d.body} elevation ${r.bodyElDegMin} to ${r.bodyElDegMax} deg (${Math.round(r.shareOfRunBodyAboveFlatHorizon * 100)}% of the run above the flat horizon; ${r.shareOfRunBodyAboveFlatHorizon > 0.5 ? 'terrain hides it' : 'it is below the local horizontal, so the skyline is not the main cause'}); terrain distance ${r.terrainDistKmMin} to ${r.terrainDistKmMax} km`);
    }
  }
  L.push('');
});
L.push('## Share of landing times that work, lunar-day, 2 m', '', '| Site | Share | Windows | Median d | Longest d |', '|---|---|---|---|---|');
for (const s of lunarDay2) L.push(`| ${s.site} | ${Math.round(s.okShare * 100)}% | ${s.windows.count} | ${s.windows.medianDays} | ${s.windows.longestDays} |`);
L.push('', '## All profiles and heights, working share', '', '| Site | Profile | Height | Share | Windows | Median d | Longest d |', '|---|---|---|---|---|---|---|');
for (const s of stats.sort((a, b) => a.site.localeCompare(b.site) || a.profile.localeCompare(b.profile) || a.height - b.height)) {
  L.push(`| ${s.site} | ${s.profile} | ${s.height} | ${Math.round(s.okShare * 100)}% | ${s.windows.count} | ${s.windows.medianDays} | ${s.windows.longestDays} |`);
}
const pairLine = (p: PairResult) => `- ${p.site} vs ${p.other}, ${p.profile}, ${p.height} m: share A ${p.shareA}, B ${p.shareB}; A-only ${p.aOnlyCount} times, B-only ${p.bOnlyCount}; longest A-only run ${p.longestAonly ? `${p.longestAonly.days} d from ${p.longestAonly.startUtc} (B fails: ${p.longestAonly.codeB})` : 'none'}; longest B-only run ${p.longestBonly ? `${p.longestBonly.days} d from ${p.longestBonly.startUtc} (A fails: ${p.longestBonly.codeA})` : 'none'}`;
L.push('', '## Position pairs (A = listed point, B = crest), best 12 by longest run', '', ...bestPos.slice(0, 12).map(pairLine));
L.push('', '## Height pairs (A = 2 m, B = 10 m), best 12 by longest 10-m-only run', '', ...bestHgt.slice(0, 12).map(pairLine));
L.push('', '## Skipped', '', ...skipped.map((s) => `- ${s.id}: ${s.reason}`));
writeFileSync(join(OUT, 'stories.md'), L.join('\n') + '\n');
console.log('done', top.length, 'top candidates');
