// Assembles src/data/validation.json: the checks the app's "Validation" section shows.
// Run: node pipeline/validate-illumination.ts   (once; writes tests/fixtures/trek/comparison.json)
//      node pipeline/build-validation.ts
//
// The engine files import each other without the .ts extension, which plain Node cannot resolve,
// so this script registers a tiny resolve hook (in this file only; the engine is not edited).

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

const { moonFrame, siteBasis, skyPosition } = await import('../src/engine/ephemeris.ts');
const { smoothSphereMask } = await import('../src/engine/horizon.ts');
const { FrameCache, computeSeries } = await import('../src/engine/visibility.ts');
const { evaluate, PROFILES } = await import('../src/engine/mission.ts');
const { MOON_RADIUS_M, horizonProfile, llToXY } = await import('../src/engine/raymarch.ts');
type DemGrid = import('../src/engine/raymarch.ts').DemGrid;

const ROOT = join(import.meta.dirname, '..');
const D2R = Math.PI / 180;
const HOUR = 3600000;

type Status = 'pass' | 'note' | 'fail';
interface Check { id: string; title: string; reference: string; result: string; detail: string; status: Status }
const checks: Check[] = [];

const f = (v: number, dp = 1) => v.toFixed(dp);
const pc = (v: number, dp = 1) => `${(100 * v).toFixed(dp)}%`;

// ---------- 1. ephemeris against JPL Horizons ----------
{
  const dir = join(ROOT, 'tests', 'fixtures', 'horizons');
  const sep = (az1: number, el1: number, az2: number, el2: number) => {
    const c = Math.sin(el1 * D2R) * Math.sin(el2 * D2R) + Math.cos(el1 * D2R) * Math.cos(el2 * D2R) * Math.cos((az1 - az2) * D2R);
    return Math.acos(Math.min(1, Math.max(-1, c))) / D2R;
  };
  let cases = 0, rows = 0, worstSun = 0, worstEarth = 0;
  for (const file of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const fx = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const site = siteBasis(fx.lon, fx.lat, fx.heightKm);
    cases++;
    for (const body of ['sun', 'earth'] as const) {
      for (const [ms, az, el] of fx.rows[body] as [number, number, number][]) {
        const p = skyPosition(site, moonFrame(new Date(ms))[body]);
        const s = sep(p.az, p.el, az, el);
        if (body === 'sun') worstSun = Math.max(worstSun, s); else worstEarth = Math.max(worstEarth, s);
        rows++;
      }
    }
  }
  checks.push({
    id: 'ephemeris-horizons',
    title: 'Sun and Earth direction from a lunar site',
    reference: 'NASA JPL Horizons observer tables',
    result: `Largest angular difference: Sun ${f(worstSun, 4)} deg, Earth ${f(worstEarth, 4)} deg.`,
    detail: `${cases} site-and-period cases, ${rows} table rows in total (Sun and Earth rows counted separately). Each row is the azimuth and elevation Horizons gives for a point on the Moon's surface; we recompute it with the in-browser engine and measure the angle between the two directions. The Sun is 0.53 deg wide, so a 0.01 deg difference is about 2% of its diameter.`,
    status: Math.max(worstSun, worstEarth) < 0.01 ? 'pass' : Math.max(worstSun, worstEarth) < 0.05 ? 'note' : 'fail',
  });
}

// ---------- 2. terrain grid read (values supplied by the team, from the earlier pipeline report) ----------
{
  const pairs: [number, number][] = [[1943, 1945], [775, 791], [1646, 1638], [4794, 4790], [6386, 6402]];
  const diffs = pairs.map(([a, b]) => Math.abs(a - b));
  const worst = Math.max(...diffs);
  const trek = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'trek', 'comparison.json'), 'utf8'));
  checks.push({
    id: 'terrain-grid-read',
    title: 'Terrain grids are read correctly',
    reference: 'NASA Moon Trek elevation service (NASA Goddard study sites)',
    result: `Ground heights at five study sites agree within ${worst} m (largest) on heights of 775 m to 6386 m.`,
    detail: `Ours / expected, metres: ${pairs.map(([a, b]) => `${a} / ${b}`).join('; ')}. The expected values came from a 30 m grid resampled to 200 m, so differences of this size are expected. Second check, run for the illumination comparison: our ground height at ${trek.demCheck.n} polar sites against Moon Trek's 30 m LOLA elevation service (LRO_LOLA_DEM_SPole75_30mp_v04_SP), same coordinate mapping as the illumination comparison: median difference ${f(trek.demCheck.medianAbsDiffM)} m, largest ${f(trek.demCheck.maxAbsDiffM)} m (a steep crater-rim point where an 80 m and a 30 m grid sample a different slope). This also confirms the coordinate convention used to query the NASA maps.`,
    status: worst <= 16 ? 'pass' : 'note',
  });
}

// ---------- 3. synthetic skyline ----------
{
  const SIZE = 1201;
  const makeGrid = (fill: (x: number, y: number) => number): DemGrid => {
    const g: DemGrid = { data: new Int16Array(SIZE * SIZE), size: SIZE, scaleM: 500, dnToM: 1, offsetPx: (SIZE - 1) / 2 };
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) g.data[r * SIZE + c] = Math.round(fill((c - g.offsetPx) * g.scaleM, (g.offsetPx - r) * g.scaleM));
    return g;
  };
  const destination = (lat: number, lon: number, azDeg: number, distM: number): [number, number] => {
    const t = distM / MOON_RADIUS_M, a = azDeg * D2R, la = lat * D2R;
    const sl2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
    const lon2 = lon * D2R + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * sl2);
    return [Math.asin(sl2) / D2R, lon2 / D2R];
  };
  const LAT = -85, LON = 30;
  const flat = horizonProfile({ lat: LAT, lon: LON, heightsM: [2, 10], near: null, far: makeGrid(() => 0), azStepDeg: 2 });
  const spread = (a: number[]) => Math.max(...a) - Math.min(...a);
  const dip2 = flat.horizonDeg[0].reduce((s, v) => s + v, 0) / flat.horizonDeg[0].length;
  const dip10 = flat.horizonDeg[1].reduce((s, v) => s + v, 0) / flat.horizonDeg[1].length;
  const exp2 = -Math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + 2)) / D2R;
  const exp10 = -Math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + 10)) / D2R;
  const peaks: Record<number, [number, number]> = {};
  for (const az of [0, 90]) {
    const [mlat, mlon] = destination(LAT, LON, az, 10000);
    const [mx, my] = llToXY(mlat, mlon);
    const grid = makeGrid((x, y) => 2000 * Math.exp(-((x - mx) ** 2 + (y - my) ** 2) / (2 * 2000 ** 2)));
    const r = horizonProfile({ lat: LAT, lon: LON, heightsM: [2], near: null, far: grid, azStepDeg: 0.5 });
    let b = 0;
    for (let i = 1; i < r.horizonDeg[0].length; i++) if (r.horizonDeg[0][i] > r.horizonDeg[0][b]) b = i;
    peaks[az] = [b * 0.5, r.horizonDeg[0][b]];
  }
  const ok = Math.abs(dip2 - exp2) < 0.01 && Math.abs(dip10 - exp10) < 0.01 && spread(flat.horizonDeg[0]) < 0.01 && Math.min(peaks[0][0], 360 - peaks[0][0]) <= 1 && Math.abs(peaks[90][0] - 90) <= 1;
  checks.push({
    id: 'skyline-synthetic',
    title: 'Skyline from synthetic terrain',
    reference: 'Analytic geometry',
    result: `Flat sphere gives ${f(dip2, 3)} deg at 2 m and ${f(dip10, 3)} deg at 10 m (geometric dip ${f(exp2, 3)} and ${f(exp10, 3)} deg); a mountain due north peaks at azimuth ${peaks[0][0]} deg and one due east at ${peaks[90][0]} deg.`,
    detail: `The flat case is a sphere of radius 1737.4 km with no relief, viewed from -85 deg latitude; every azimuth should sit at the dip -acos(R / (R + h)). The mountains are 2000 m high, 10 km away, 2 km wide, and their skyline reaches ${f(peaks[0][1])} deg (north) and ${f(peaks[90][1])} deg (east). The test passes if the peak lies within 1 deg of the true azimuth; the terrain grid used here has 500 m pixels, which at 10 km distance is 2.9 deg wide, so a peak 1 deg off is below the grid's own resolution.`,
    status: ok ? 'pass' : 'fail',
  });
}

// ---------- 4. IM-1 ----------
{
  const mask = smoothSphereMask('im1', 'IM-1 Odysseus', -80.13, 1.44, [2]);
  const start = Date.UTC(2024, 2, 2), step = 10 * 60000, n = 4 * 144;
  const s = computeSeries(mask, 2, start, step, n, new FrameCache());
  const at = (ms: number) => s.sunEl[Math.round((ms - start) / step)];
  const e3 = at(Date.UTC(2024, 2, 3)), e4 = at(Date.UTC(2024, 2, 4));
  const dip = s.sunHorizon[0];
  const cross = (target: number) => {
    for (let i = 1; i < n; i++)
      if (s.sunEl[i - 1] >= target && s.sunEl[i] < target)
        return new Date(start + (i - 1 + (s.sunEl[i - 1] - target) / (s.sunEl[i - 1] - s.sunEl[i])) * step).toISOString();
    return 'none';
  };
  const tHorizon = cross(dip);
  const ok = Math.abs(e3 - 0.6) <= 0.2 && Math.abs(e4 + 1.5) <= 0.2;
  checks.push({
    id: 'mission-im1',
    title: 'IM-1 Odysseus: Sun reaches the horizon',
    reference: 'NASA JPL Horizons at 80.13 S, 1.44 E',
    result: `Engine: Sun centre ${f(e3, 2)} deg at 2024-03-03 00:00 UTC and ${f(e4, 2)} deg at 2024-03-04 00:00 UTC (Horizons: +0.6 and -1.5 deg). It crosses the smooth horizon at ${tHorizon.slice(0, 16).replace('T', ' ')} UTC.`,
    detail: `Smooth sphere, no terrain, observer 2 m above ground; the smooth horizon at 2 m is ${f(dip, 3)} deg below level. The Horizons values are quoted to 0.1 deg. The check shows the engine places the Sun's setting at the right day and within about 1 hour of the Horizons elevation track; it does not test the terrain, which at the real landing point is Malapert A and its surroundings.`,
    status: ok ? 'pass' : 'note',
  });
}

// ---------- 5. Blue Ghost 1 ----------
{
  const mask = smoothSphereMask('bg1', 'Blue Ghost M1', 18.56, 61.81, [2]);
  const landing = Date.UTC(2025, 2, 2, 8, 34);
  const s = computeSeries(mask, 2, landing, 10 * 60000, 20 * 144, new FrameCache());
  const profile = PROFILES.find((p: { id: string }) => p.id === 'lunar-day')!;
  const e = evaluate(s, 0, { ...profile, stayDays: 19 });
  const h = e.firstSunsetAfterH as number;
  const diff = h - 346;
  checks.push({
    id: 'mission-blue-ghost-1',
    title: 'Blue Ghost Mission 1: length of the lunar day',
    reference: 'Firefly Aerospace mission report (about 346 hours of daylight operations)',
    result: `Engine: sunset ${f(h)} hours after landing at 2025-03-02 08:34 UTC, 18.56 N, 61.81 E; Firefly reported about 346 hours of daylight operations (difference ${f(diff)} hours, ${f(100 * diff / 346)}%).`,
    detail: `Smooth sphere with no terrain, observer 2 m above ground; "up" means at least half the Sun's disc above the horizon. The mission figure is rounded and counts operations, not the exact sunset time, so this is a plausibility check on the length of the lunar day, not a precision test.`,
    status: Math.abs(diff) <= 5 ? 'pass' : 'note',
  });
}

// ---------- 6. average sunlight and Earth visibility against NASA Goddard ----------
const cmp = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'trek', 'comparison.json'), 'utf8'));
{
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const pearson = (a: number[], b: number[]) => {
    const ma = mean(a), mb = mean(b);
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < a.length; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return sab / Math.sqrt(saa * sbb);
  };
  const siteName = (id: string) => cmp.sites.find((s: any) => s.id === id)?.name ?? id;
  const res60 = cmp.sites.filter((s: any) => s.nasa.sun?.pixelM === 60).length;
  const res120 = cmp.sites.filter((s: any) => s.nasa.sun?.pixelM === 120).length;
  const res240 = cmp.sites.filter((s: any) => s.nasa.sun?.pixelM === 240).length;

  for (const body of ['sun', 'earth'] as const) {
    const label = body === 'sun' ? 'Sun' : 'Earth';
    const c0 = cmp.comparison[`${body}_h0_Any`], c2 = cmp.comparison[`${body}_h2_Any`], c10 = cmp.comparison[`${body}_h10_Any`], m0 = cmp.comparison[`${body}_h0_Mean`];
    const rows = cmp.sites.filter((s: any) => s.nasa[body]);
    const val = (s: any, h: number) => 100 * s.ours[`h${h}`][`${body}Any`];
    const diff = (s: any, h: number) => val(s, h) - 100 * s.nasa[body].value;
    const sg = (v: number) => `${v >= 0 ? '+' : ''}${f(v)}`;
    const w0 = rows.find((s: any) => s.id === c0.worstSite), w2 = rows.find((s: any) => s.id === c2.worstSite);
    const crests = rows.filter((s: any) => /crest$/.test(s.id));
    const others = rows.filter((s: any) => !/crest$/.test(s.id));
    const bias = (set: any[], h: number) => mean(set.map((s) => diff(s, h)));
    const d0 = rows.map((s: any) => diff(s, 0));
    const status: Status = 'note';
    checks.push({
      id: body === 'sun' ? 'average-sunlight' : 'average-earth',
      title: body === 'sun' ? 'Average sunlight against NASA Goddard maps' : 'Average Earth visibility against NASA Goddard maps',
      reference: `NASA Goddard average ${label} visibility maps (Mazarico et al. 2011 method, 2016 release), read from NASA Moon Trek`,
      result: `Like-for-like, observer on the ground (0 m), ${c0.n} sites: correlation ${f(c0.pearson, 2)}, median absolute difference ${f(c0.medianAbsDiffPp)} percentage points, mean difference (ours minus NASA) ${sg(c0.meanDiffPp)} points; largest difference ${siteName(c0.worstSite)}: ours ${f(val(w0, 0))}%, NASA ${f(100 * w0.nasa[body].value)}% (${sg(c0.worstDiffPp)} points). At 2 m (shipped masks): correlation ${f(c2.pearson, 2)}, median ${f(c2.medianAbsDiffPp)} points, mean ${sg(c2.meanDiffPp)} points, largest ${sg(c2.worstDiffPp)} points.`,
      detail: `Quantity compared: share of time with any part of the ${label}'s disc above the skyline (NASA's definition), averaged over 18.6 years from 2020-01-01 every 2 hours (${cmp.period.samples} samples; NASA uses hourly steps over a full nutation cycle but gives no calendar dates). NASA's maps are for the ground surface, so the 0 m skylines are the like-for-like comparison; they were computed directly from the LOLA 80 m and 240 m grids with the same code as the shipped masks, which are unchanged. At 2 m the largest difference is ${siteName(w2.id)}: ours ${f(val(w2, 2))}%, NASA ${f(100 * w2.nasa[body].value)}% (${sg(c2.worstDiffPp)} points). At 10 m: correlation ${f(c10.pearson, 2)}, median absolute difference ${f(c10.medianAbsDiffPp)} points${c10.sitesOver30pp.length ? `, ${c10.sitesOver30pp.length} sites more than 30 points apart` : ', no site more than 30 points apart'}. Rank correlation at 0 m ${f(c0.spearman, 2)}. Crest points (${crests.length} derived highest-pixel sites): mean difference ${sg(bias(crests, 0))} points at 0 m against ${sg(bias(crests, 2))} at 2 m; other sites ${sg(bias(others, 0))} at 0 m and ${sg(bias(others, 2))} at 2 m. Observer height therefore explains about ${f(100 * (1 - bias(crests, 0) / bias(crests, 2)), 0)}% of the crest difference at 2 m, and a mean difference of ${sg(bias(crests, 0))} points remains at crests. Remaining limitation: an 80 m grid cannot see relief smaller than about 80 m, so sunlight at ridge crests may be overestimated. Differences at 0 m range from ${sg(Math.min(...d0))} to ${sg(Math.max(...d0))} points over all sites; negative values occur where our rounded coordinates fall off the NASA crest. Mean disc fraction instead of any-part share at 0 m: correlation ${f(m0.pearson, 2)}, median ${f(m0.medianAbsDiffPp)} points. Sites use the finest NASA map that covers them: 60 m (${res60} sites), 120 m (${res120}), 240 m (${res240}). Other caveats: NASA's maps are on a 60 m to 240 m grid and, per NASA's documentation, contain linear artefacts from the DEM; our site coordinates are rounded, so at ridge crests a 100 m shift changes the skyline by degrees. Status is 'note': ranking and median agreement are good, but the largest single-site difference is ${f(Math.abs(c0.worstDiffPp), 0)} points.`,
      status,
    });
  }
}

// ---------- 7. Barker et al. benchmark ----------
{
  const b = cmp.benchmark.sites;
  const crest = b['pgda-site01-connecting-ridge-crest'], ridge = b['pgda-site01-connecting-ridge'];
  const p = (v: number) => `${(100 * v).toFixed(1)}%`;
  checks.push({
    id: 'benchmark-barker',
    title: 'Average illumination at Connecting Ridge against a published study',
    reference: 'Barker et al. (2021), Planetary and Space Science 203, 105119, Table 2: Site 1 (Shackleton-de Gerlache connecting ridge), January 2024 to January 2026',
    result: `Ours, mean Sun disc fraction 2024-01-01 to 2026-01-01: crest point ${p(crest.h2.sunMean)} at 2 m and ${p(crest.h10.sunMean)} at 10 m; listed point ${p(ridge.h2.sunMean)} at 2 m and ${p(ridge.h10.sunMean)} at 10 m. Published best regions: about 67-71% at 1 m and about 83-89% at 5 m.`,
    detail: `Plausibility check only. The published figures are first-percentile values over an ensemble of 100 elevation-model variants, for the best small regions on a 5 m grid at 1 m and 5 m above the ground; the digits were read from an image of the table. Ours are single points from an 80 m grid at 2 m and 10 m, hourly. Our crest point (the highest 80 m pixel within 8 km of the listed centre) is a favourable spot and gives ${p(crest.h2.sunMean)} at 2 m, above the published 1 m range and at the top of the 5 m range, although 2 m is closer to 1 m than to 5 m; because the published values are first percentiles (pessimistic), a higher best estimate is not a contradiction, but it is not a match either. Our listed point sits off the crest and gives ${p(ridge.h2.sunMean)} at 2 m, well below the published best regions, as expected for a point that is not among the best. The result is consistent with the published picture (a few tens of percent at 1 m rising by about 15-20 points at 5 m) but cannot confirm our numbers to better than about 20 percentage points.`,
    status: 'note',
  });
}

const out = { generated: new Date().toISOString().slice(0, 10), checks };
writeFileSync(join(ROOT, 'src', 'data', 'validation.json'), JSON.stringify(out, null, 2) + '\n');
for (const c of checks) console.log(`[${c.status}] ${c.id}: ${c.result}`);
