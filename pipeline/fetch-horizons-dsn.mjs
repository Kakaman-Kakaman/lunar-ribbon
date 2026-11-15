// Downloads the Moon's apparent azimuth and elevation (no refraction) from NASA JPL Horizons as seen
// from the three DSN complexes, for tests/dsn.test.ts. Station coordinates are the 70 m antennas in
// DSN handbook 810-005, module 301 Rev. N, Table 5 (also in src/engine/dsn.ts).
// Run: node pipeline/fetch-horizons-dsn.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'dsn', 'moon-2027.json');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const dms = (d, m, s, sign = 1) => sign * (d + m / 60 + s / 3600);

// id, east longitude (0..360), latitude, height km
const STATIONS = [
  ['goldstone', dms(243, 6, 37.66244), dms(35, 25, 33.24312), 1.00139],
  ['canberra', dms(148, 58, 52.56231), dms(35, 24, 8.72724, -1), 0.688867],
  ['madrid', dms(355, 45, 7.16924), dms(40, 25, 52.3551), 0.864816],
];
const START = '2027-10-13 00:00', STOP = '2027-10-20 00:00', STEP = '1 h';
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function url(lon, lat, hKm) {
  const q = {
    format: 'text', COMMAND: `'301'`, OBJ_DATA: `'NO'`, MAKE_EPHEM: `'YES'`, EPHEM_TYPE: `'OBSERVER'`,
    CENTER: `'coord@399'`, COORD_TYPE: `'GEODETIC'`, SITE_COORD: `'${lon},${lat},${hKm}'`,
    START_TIME: `'${START}'`, STOP_TIME: `'${STOP}'`, STEP_SIZE: `'${STEP}'`,
    QUANTITIES: `'4'`, ANG_FORMAT: `'DEG'`, CSV_FORMAT: `'YES'`, APPARENT: `'AIRLESS'`,
  };
  return `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

function parseRows(text) {
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`No ephemeris block in Horizons reply:\n${text.slice(0, 600)}`);
  return body.trim().split('\n').map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const [, y, mon, d, hh, mm] = cells[0].match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
    return [Date.UTC(+y, MONTHS[mon], +d, +hh, +mm), Number(cells[3]), Number(cells[4])];
  });
}

const out = { source: 'NASA JPL Horizons', fetched: new Date().toISOString(), body: 'Moon (301)', refraction: 'none (AIRLESS)', queries: {}, rows: {} };
for (const [id, lon, lat, h] of STATIONS) {
  const u = url(lon, lat, h);
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status} for ${id}`);
  out.queries[id] = u;
  out.rows[id] = parseRows(await res.text());
  console.log(`${id}: ${out.rows[id].length} rows`);
  await new Promise((r) => setTimeout(r, 1200));
}
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
