// Builds per-site horizon masks from the LOLA south polar DEMs.
// Run: node pipeline/build-masks.ts
import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { horizonProfile, llToXY, xyToLL, sampleDem, type DemGrid } from '../src/engine/raymarch.ts';

function loadImg(path: string): Int16Array {
  const buf = readFileSync(path);
  return new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const near: DemGrid = {
  data: loadImg('data-raw/lola/LDEM_80S_80M.IMG'),
  size: 7600,
  scaleM: 80,
  dnToM: 0.5,
  offsetPx: 3799.5,
};
const far: DemGrid = {
  data: loadImg('data-raw/lola/LDEM_60S_240M.IMG'),
  size: 7760,
  scaleM: 240,
  dnToM: 0.5,
  offsetPx: 3879.5,
};

interface Site {
  id: string;
  name: string;
  group: string;
  lat: number;
  lon: number;
  source: string;
  sourceQuality: string;
  note: string;
}

const HEIGHTS = [2, 10];
const AZ_STEP = 0.5;
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

const catalogue = JSON.parse(readFileSync('src/data/sites.json', 'utf8')).sites as Site[];
const sites: Site[] = catalogue.filter((s) => s.lat <= -60);

// Crest variants: highest 80 m pixel within 8 km of each study site's listed centre.
function crestOf(s: Site): Site {
  const [cx, cy] = llToXY(s.lat, s.lon);
  const rad = 8000;
  const pr = Math.ceil(rad / near.scaleM) + 2;
  const c0 = Math.round(cx / near.scaleM + near.offsetPx);
  const r0 = Math.round(near.offsetPx - cy / near.scaleM);
  let best = -Infinity;
  let bx = cx;
  let by = cy;
  for (let r = r0 - pr; r <= r0 + pr; r++) {
    for (let c = c0 - pr; c <= c0 + pr; c++) {
      const x = (c - near.offsetPx) * near.scaleM;
      const y = (near.offsetPx - r) * near.scaleM;
      const k = 1 + (Math.hypot(x, y) / (2 * 1737400)) ** 2; // stereographic scale factor
      if (Math.hypot(x - cx, y - cy) / k > rad) continue;
      const v = near.data[r * near.size + c];
      if (v > best) {
        best = v;
        bx = x;
        by = y;
      }
    }
  }
  const [lat, lon] = xyToLL(bx, by);
  return {
    ...s,
    id: `${s.id}-crest`,
    name: `${s.name} \u2014 highest point within 8 km`,
    lat: round(lat, 4),
    lon: round(lon, 4),
    sourceQuality: 'derived',
    note: `Derived from the LOLA 80 m grid (LDEM_80S_80M): the highest pixel within 8 km of the listed centre (${s.lat}, ${s.lon}); height ${best * 0.5} m. Parent note: ${s.note}`,
  };
}
const crests = sites.filter((s) => s.group === 'study-site').map(crestOf);
const all = [...sites, ...crests];

mkdirSync('public/masks', { recursive: true });
for (const f of readdirSync('public/masks')) if (f.endsWith('.json')) unlinkSync(`public/masks/${f}`);

const t0 = Date.now();
const index: unknown[] = [];
for (const s of all) {
  const [x, y] = llToXY(s.lat, s.lon);
  const terrain = Number.isNaN(sampleDem(near, x, y)) ? 'lola-240m' : 'lola-80m+240m';
  const r = horizonProfile({ lat: s.lat, lon: s.lon, heightsM: HEIGHTS, near, far, azStepDeg: AZ_STEP });
  const horizonDeg: Record<string, number[]> = {};
  const distKm: Record<string, number[]> = {};
  HEIGHTS.forEach((h, i) => {
    horizonDeg[String(h)] = r.horizonDeg[i].map((v) => round(v, 2));
    distKm[String(h)] = r.distKm[i].map((v) => round(v, 1));
  });
  const groundElevM = round(r.groundElevM, 1);
  const out = {
    id: s.id,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    group: s.group,
    groundElevM,
    terrain,
    azStepDeg: AZ_STEP,
    heightsM: HEIGHTS,
    horizonDeg,
    distKm,
    source: s.source,
    sourceQuality: s.sourceQuality,
    note: s.note,
  };
  writeFileSync(`public/masks/${s.id}.json`, JSON.stringify(out));
  index.push({
    id: s.id, name: s.name, lat: s.lat, lon: s.lon, group: s.group, terrain, groundElevM,
    source: s.source, sourceQuality: s.sourceQuality, note: s.note,
  });
  console.log(`${s.id}: ground ${groundElevM} m, terrain ${terrain}`);
}
writeFileSync('public/masks/index.json', JSON.stringify(index, null, 1) + '\n');
console.log(`wrote ${all.length} masks in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
