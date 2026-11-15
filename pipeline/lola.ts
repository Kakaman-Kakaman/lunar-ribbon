// Loads LOLA polar stereographic elevation grids (PDS3 .IMG with a detached .LBL) for the pipeline.
// Every number the engine needs is read from the label, and the label is checked against the
// projection the engine assumes (src/engine/raymarch.ts: south pole centre, east-positive,
// sphere of radius 1737.4 km, 16-bit little-endian heights).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DemGrid } from '../src/engine/raymarch.ts';

export const LOLA_DIR = join(import.meta.dirname, '..', 'data-raw', 'lola');

/** Value of `KEY = value` in a PDS3 label, without units or quotes. */
function field(lbl: string, key: string): string {
  const m = lbl.match(new RegExp(`^\\s*${key}\\s*=\\s*([^\\r\\n]+)`, 'm'));
  if (!m) throw new Error(`label has no ${key}`);
  return m[1].replace(/<[^>]*>/, '').replace(/"/g, '').trim();
}

export interface LolaGrid extends DemGrid {
  name: string;
  /** The grid covers latitudes from the pole to this one (e.g. -87.5). */
  edgeLatDeg: number;
}

/** Reads `<name>.LBL` and `<name>.IMG` from data-raw/lola. Throws if the label does not match the engine's assumptions. */
export function loadLola(name: string, dir = LOLA_DIR): LolaGrid {
  const lblPath = join(dir, `${name}.LBL`);
  const imgPath = join(dir, `${name}.IMG`);
  if (!existsSync(lblPath) || !existsSync(imgPath)) throw new Error(`${name}: missing .LBL or .IMG in ${dir}`);
  const lbl = readFileSync(lblPath, 'latin1');
  const lines = Number(field(lbl, 'LINES'));
  const samples = Number(field(lbl, 'LINE_SAMPLES'));
  const checks: [string, string][] = [
    ['SAMPLE_TYPE', 'LSB_INTEGER'],
    ['SAMPLE_BITS', '16'],
    ['MAP_PROJECTION_TYPE', 'POLAR STEREOGRAPHIC'],
    ['CENTER_LATITUDE', '-90'],
    ['CENTER_LONGITUDE', '0'],
    ['POSITIVE_LONGITUDE_DIRECTION', 'EAST'],
    ['A_AXIS_RADIUS', '1737.4'],
  ];
  for (const [k, want] of checks) {
    const got = field(lbl, k);
    if (got !== want) throw new Error(`${name}: ${k} is ${got}, expected ${want}`);
  }
  const lineOff = Number(field(lbl, 'LINE_PROJECTION_OFFSET'));
  const sampleOff = Number(field(lbl, 'SAMPLE_PROJECTION_OFFSET'));
  if (lines !== samples || lineOff !== sampleOff) throw new Error(`${name}: grid is not square and centred on the pole`);

  const buf = readFileSync(imgPath);
  if (buf.byteLength !== lines * samples * 2) throw new Error(`${name}: .IMG is ${buf.byteLength} bytes, label implies ${lines * samples * 2} (incomplete download?)`);
  // A view on the file's own memory: no copy, which matters for the 1.8 GB grids.
  const data = buf.byteOffset % 2 === 0
    ? new Int16Array(buf.buffer, buf.byteOffset, lines * samples)
    : new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return {
    name,
    data,
    size: lines,
    scaleM: Number(field(lbl, 'MAP_SCALE')),
    dnToM: Number(field(lbl, 'SCALING_FACTOR')),
    offsetPx: lineOff,
    edgeLatDeg: Number(field(lbl, 'MAXIMUM_LATITUDE')),
  };
}

/** The south-pole grids present on disk, finest first, from the set the project uses. */
export function availableSouthGrids(dir = LOLA_DIR): string[] {
  return ['LDEM_875S_5M', 'LDEM_85S_10M', 'LDEM_80S_20M', 'LDEM_80S_80M', 'LDEM_60S_240M'].filter(
    (n) => existsSync(join(dir, `${n}.IMG`)) && existsSync(join(dir, `${n}.LBL`)),
  );
}
