// E3 per-date check (D-049): our Sun and Earth verdicts against ACT's Artemis III Geotechnical (A3GT)
// Malapert Massif cubes: 2 m pixels, 4 km x 4 km, 113 epochs every 6 h from 2025-12-01 to 2025-12-29,
// illumination from the Sun's centre (cube metadata "SUN_CENTER"), built on NASA Goddard 5 m site DEMs,
// LROC NAC DTMs and LOLA 60 m (cube metadata). For a 15 x 15 grid of points inside the cube, our
// skyline on the nested 10/20/240 m terrain at ground level gives "visible" when the body's centre is
// at or above the skyline at its azimuth. Agreement is counted per point and epoch.
// Run: node pipeline/check-a3gt.ts      Output: pipeline/out/a3gt-check.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { fromFile } from 'geotiff';

register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`),
  import.meta.url,
);

const { horizonProfile, xyToLL } = await import('../src/engine/raymarch.ts');
const { horizonAt } = await import('../src/engine/horizon.ts');
const { siteBasis, skyPosition } = await import('../src/engine/ephemeris.ts');
const { FrameCache } = await import('../src/engine/visibility.ts');
const { loadTerrainStack, loadMainStack } = await import('./terrain-stack.ts');

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'data-raw', 'a3gt');
const GRID = 15, AZ = 0.1, HEIGHTS = [0, 2];

const { stack, source: terrainSource } = await loadMainStack();
console.log(`terrain: ${terrainSource}`);
console.log(`nested stack: ${stack.map((g) => g.name).join(' > ')}`);
const sun = await (await fromFile(join(DIR, 'mm_dec25_2mpp_svmask.tif'))).getImage(0);
const earth = await (await fromFile(join(DIR, 'mm_dec25_2mpp_evmask.tif'))).getImage(0);
const md = (await sun.getGDALMetadata()) as Record<string, string>;
const [ox, oy] = sun.getOrigin();
const [rx, ry] = sun.getResolution();
const w = sun.getWidth(), h = sun.getHeight(), nb = sun.getSamplesPerPixel();
const epochs: number[] = [];
for (let b = 0; b < nb; b++) epochs.push(Date.parse(((await sun.getGDALMetadata(b)) as Record<string, string>).DESCRIPTION + 'Z'));
console.log(`cube ${w} x ${h} px at ${rx} m, ${nb} epochs ${new Date(epochs[0]).toISOString()} .. ${new Date(epochs[nb - 1]).toISOString()}, source ${md['Source of Illumination']}`);

const frames = new FrameCache();
const tally = HEIGHTS.map(() => ({ sun: { both: 0, oursOnly: 0, theirsOnly: 0, neither: 0 }, earth: { both: 0, oursOnly: 0, theirsOnly: 0, neither: 0 } }));
const points: any[] = [];
const margin = 100; // pixels kept away from the cube edge
for (let gi = 0; gi < GRID; gi++) for (let gj = 0; gj < GRID; gj++) {
  const c = Math.round(margin + (gj * (w - 2 * margin)) / (GRID - 1));
  const r = Math.round(margin + (gi * (h - 2 * margin)) / (GRID - 1));
  const x = ox + (c + 0.5) * rx, y = oy + (r + 0.5) * ry;
  const [lat, lon] = xyToLL(x, y);
  const theirsSun = (await sun.readRasters({ window: [c, r, c + 1, r + 1] })) as unknown as ArrayLike<number>[];
  const theirsEarth = (await earth.readRasters({ window: [c, r, c + 1, r + 1] })) as unknown as ArrayLike<number>[];
  const hp = horizonProfile({ lat, lon, heightsM: HEIGHTS, near: null, far: null, azStepDeg: AZ, grids: stack.map((grid) => ({ grid })) });
  const pt: any = { c, r, lat, lon, groundM: hp.groundElevM, agree: {} };
  HEIGHTS.forEach((hm, hi) => {
    const basis = siteBasis(lon, lat, (hp.groundElevM + hm) / 1000);
    let agreeSun = 0, agreeEarth = 0;
    for (let b = 0; b < nb; b++) {
      const f = frames.get(epochs[b]);
      const s = skyPosition(basis, f.sun), e = skyPosition(basis, f.earth);
      const oursS = s.el >= horizonAt(hp.horizonDeg[hi], AZ, s.az), oursE = e.el >= horizonAt(hp.horizonDeg[hi], AZ, e.az);
      const thS = theirsSun[b][0] >= 0.5, thE = theirsEarth[b][0] >= 0.5;
      const key = (o: boolean, t: boolean) => (o && t ? 'both' : o ? 'oursOnly' : t ? 'theirsOnly' : 'neither') as 'both';
      tally[hi].sun[key(oursS, thS)]++; tally[hi].earth[key(oursE, thE)]++;
      if (oursS === thS) agreeSun++;
      if (oursE === thE) agreeEarth++;
    }
    pt.agree[`h${hm}`] = { sun: agreeSun / nb, earth: agreeEarth / nb };
  });
  points.push(pt);
  if (points.length % 15 === 0) console.log(`${points.length} of ${GRID * GRID} points`);
}
const rate = (t: { both: number; oursOnly: number; theirsOnly: number; neither: number }) => (t.both + t.neither) / (t.both + t.oursOnly + t.theirsOnly + t.neither);
const summary = HEIGHTS.map((hm, i) => ({ heightM: hm, sunAgreement: rate(tally[i].sun), earthAgreement: rate(tally[i].earth), sun: tally[i].sun, earth: tally[i].earth }));
mkdirSync(join(ROOT, 'pipeline/out'), { recursive: true });
writeFileSync(join(ROOT, 'pipeline/out/a3gt-check.json'), JSON.stringify({ generated: new Date().toISOString(), stack: stack.map((g) => g.name), cube: { w, h, pixelM: rx, epochs: nb, metadata: md }, summary, points }, null, 1));
console.log(JSON.stringify(summary, null, 1));
