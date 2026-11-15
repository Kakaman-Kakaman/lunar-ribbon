// E9 check: the north polar projection against independent positions. Each IAU crater centre
// (src/data/sites-north.json) should sit in a depression, with the rim ring higher; at the mirrored
// position (longitude reflected) the difference should look random.
// Run: node pipeline/check-north-projection.ts
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  try { return await next(s, c); }
  catch (e) { if (e && e.code === 'ERR_MODULE_NOT_FOUND' && s.startsWith('.')) return next(s + '.ts', c); throw e; }
}`), import.meta.url);
import { readFileSync } from 'node:fs';
const { llToXY, sampleDem } = await import('../src/engine/raymarch.ts');
const { loadLola } = await import('./lola.ts');
const g = loadLola('LDEM_80N_80M');
console.log(g.name, g.pole, g.size, g.scaleM, g.offsetPx, g.edgeLatDeg);
const sites = JSON.parse(readFileSync(new URL('../src/data/sites-north.json', import.meta.url), 'utf8')).sites;
const ring = (x: number, y: number, r: number) => { let s = 0, n = 0; for (let k = 0; k < 72; k++) { const a = (k * 5 * Math.PI) / 180; const v = sampleDem(g, x + r * Math.sin(a), y + r * Math.cos(a)); if (!Number.isNaN(v)) { s += v; n++; } } return s / n; };
let ok = 0;
for (const s of sites) {
  const R = (s.diameterKm * 1000) / 2;
  const [x, y] = llToXY(s.lat, s.lon, 'north');
  const centre = ring(x, y, 0.15 * R), rim = ring(x, y, R);
  // the mirror-image position (latitude kept, longitude reflected) for comparison
  const [mx, my] = llToXY(s.lat, 180 - s.lon, 'north');
  const mCentre = ring(mx, my, 0.15 * R), mRim = ring(mx, my, R);
  const good = rim - centre > 0;
  if (good) ok++;
  console.log(`${s.id.padEnd(20)} D ${String(s.diameterKm).padStart(6)} km: rim - centre ${(rim - centre).toFixed(0).padStart(5)} m | at mirrored spot ${(mRim - mCentre).toFixed(0).padStart(5)} m`);
}
console.log(`${ok} of ${sites.length} centres sit in a depression`);
