// Loads NASA Goddard (PGDA) south-pole elevation GeoTIFFs, such as the crossover-adjusted
// LDEM_80S_20MPP_ADJ.TIF of Barker et al. (2023), as an engine DemGrid in metres.
// Checks the GeoTIFF keys against the projection the engine assumes (src/engine/raymarch.ts):
// polar stereographic, origin latitude -90, central longitude 0, scale 1, sphere of 1737.4 km,
// pixel-is-area, square and centred on the pole.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fromFile } from 'geotiff';
import type { LolaGrid } from './lola.ts';

export const PGDA_DIR = join(import.meta.dirname, '..', 'data-raw', 'pgda');

export async function loadPgdaDem(file: string, edgeLatDeg: number, dir = PGDA_DIR): Promise<LolaGrid> {
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`${file}: not found in ${dir}`);
  const tif = await fromFile(path);
  const img = await tif.getImage(0);
  const k = img.getGeoKeys() as Record<string, number | string>;
  const want: [string, number][] = [
    ['ProjCoordTransGeoKey', 15], // polar stereographic
    ['ProjNatOriginLatGeoKey', -90],
    ['ProjStraightVertPoleLongGeoKey', 0],
    ['ProjScaleAtNatOriginGeoKey', 1],
    ['ProjFalseEastingGeoKey', 0],
    ['ProjFalseNorthingGeoKey', 0],
    ['GeogSemiMajorAxisGeoKey', 1737400],
    ['GeogSemiMinorAxisGeoKey', 1737400],
    ['GTRasterTypeGeoKey', 1], // pixel is area: the origin is a pixel corner
  ];
  for (const [key, v] of want) if (k[key] !== v) throw new Error(`${file}: ${key} is ${k[key]}, expected ${v}`);
  const w = img.getWidth(), h = img.getHeight();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  if (w !== h || rx !== -ry || ox !== -oy || Math.abs(ox + (w * rx) / 2) > 1e-6) throw new Error(`${file}: not square and centred on the pole`);

  // Read in bands of tile rows so the decoder's working memory stays small.
  const data = new Float32Array(w * h);
  const band = img.getTileHeight() * 4;
  for (let r0 = 0; r0 < h; r0 += band) {
    const r1 = Math.min(h, r0 + band);
    const [chunk] = (await img.readRasters({ window: [0, r0, w, r1], samples: [0] })) as unknown as Float32Array[];
    data.set(chunk, r0 * w);
    if ((r0 / band) % 10 === 0) process.stdout.write(`\r${file}: ${Math.round((100 * r1) / h)}%`);
  }
  process.stdout.write(`\r${file}: 100%\n`);
  return {
    name: file.replace(/\.TIF$/i, ''),
    data,
    size: w,
    scaleM: rx,
    dnToM: 1,
    offsetPx: w / 2 - 0.5,
    edgeLatDeg,
  };
}
