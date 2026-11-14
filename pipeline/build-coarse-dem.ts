// Builds the 480 m south polar DEM (80S to the pole) for the browser from the 240 m LOLA grid.
// Run: node pipeline/build-coarse-dem.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { MOON_RADIUS_M } from '../src/engine/raymarch.ts';

const SRC_SIZE = 7760;
const SRC_SCALE = 240;
const SRC_OFFSET = 3879.5;

const buf = readFileSync('data-raw/lola/LDEM_60S_240M.IMG');
const src = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (src.length !== SRC_SIZE * SRC_SIZE) throw new Error('unexpected 240 m file size');

// Half-width of the 80S circle, in source pixels (1267 = round(2R tan 5deg / 240 m)).
const half = Math.round((2 * MOON_RADIUS_M * Math.tan((5 * Math.PI) / 180)) / SRC_SCALE);
const start = Math.round(SRC_OFFSET - 0.5) - half + 1; // first source row/col, pole sits between start+half-1 and start+half
const outSize = half; // 2*half source pixels averaged 2x2
const out = new Int16Array(outSize * outSize);
for (let r = 0; r < outSize; r++) {
  for (let c = 0; c < outSize; c++) {
    const i = (start + 2 * r) * SRC_SIZE + start + 2 * c;
    const s = src[i] + src[i + 1] + src[i + SRC_SIZE] + src[i + SRC_SIZE + 1];
    out[r * outSize + c] = Math.round(s / 4);
  }
}
// Source pole (0-based, pixel centres at integers) relative to the crop, then mapped to 2x2 block centres.
const offsetPx = (SRC_OFFSET - start - 0.5) / 2;

mkdirSync('public/terrain', { recursive: true });
writeFileSync('public/terrain/spole_80s_480m.i16', new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
writeFileSync(
  'public/terrain/spole_80s_480m.json',
  JSON.stringify(
    {
      size: outSize,
      scaleM: 480,
      dnToM: 0.5,
      offsetPx,
      source: 'LOLA LDEM_60S_240M (PDS LRO-L-LOLA-4-GDR-V1.0), 2x2 averaged',
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${outSize}x${outSize}, start=${start}, offsetPx=${offsetPx}, ${out.byteLength} bytes`);
