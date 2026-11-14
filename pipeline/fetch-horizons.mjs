// Downloads reference Sun and Earth azimuth/elevation tables from NASA JPL Horizons
// for a few lunar surface sites. The tables are the fixtures that
// tests/ephemeris.test.ts checks the in-browser engine against.
//
// Run: npm run fixtures
// Horizons places the observer on a smooth 1737.4 km sphere (no terrain), in the
// mean-Earth/polar-axis frame, east-positive longitude.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'horizons');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

// name, east longitude, latitude, start, stop, step
const CASES = [
  ['equator-2027', 23.473, 0.6741, '2027-01-01', '2028-01-01', '6 h'],
  ['pole-2027', 129.2, -89.54, '2027-01-01', '2028-01-01', '6 h'],
  ['malapert-2027', -0.2, -85.99, '2027-01-01', '2028-01-01', '6 h'],
  ['im1-2024', 1.44, -80.13, '2024-02-22', '2024-03-25', '1 h'],
  ['im2-2025', 29.196, -84.791, '2025-03-06', '2025-04-05', '1 h'],
  ['pole-2030', 129.2, -89.54, '2030-06-01', '2030-09-01', '3 h'],
];

const BODIES = { sun: '10', earth: '399' };
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

function buildUrl(command, lon, lat, start, stop, step) {
  const q = {
    format: 'text',
    COMMAND: `'${command}'`,
    OBJ_DATA: `'NO'`,
    MAKE_EPHEM: `'YES'`,
    EPHEM_TYPE: `'OBSERVER'`,
    CENTER: `'coord@301'`,
    SITE_COORD: `'${lon},${lat},0'`,
    COORD_TYPE: `'GEODETIC'`,
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${step}'`,
    QUANTITIES: `'4'`,
    ANG_FORMAT: `'DEG'`,
    CSV_FORMAT: `'YES'`,
  };
  return `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

// " 2027-Jan-01 00:00, ,i, 269.219012,   -30.364163," -> [unix ms, az, el]
function parseRows(text) {
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`No ephemeris block in Horizons reply:\n${text.slice(0, 600)}`);
  return body.trim().split('\n').map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const [, y, mon, d, hh, mm] = cells[0].match(/(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/);
    return [Date.UTC(+y, MONTHS[mon], +d, +hh, +mm), Number(cells[3]), Number(cells[4])];
  });
}

await mkdir(OUT_DIR, { recursive: true });
for (const [name, lon, lat, start, stop, step] of CASES) {
  const out = { name, lon, lat, heightKm: 0, source: 'NASA JPL Horizons', fetched: new Date().toISOString(), queries: {}, rows: {} };
  for (const [body, command] of Object.entries(BODIES)) {
    const url = buildUrl(command, lon, lat, start, stop, step);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Horizons HTTP ${res.status} for ${name}/${body}`);
    out.queries[body] = url;
    out.rows[body] = parseRows(await res.text());
    await new Promise((r) => setTimeout(r, 1200)); // be polite to the service
  }
  await writeFile(join(OUT_DIR, `${name}.json`), JSON.stringify(out));
  console.log(`${name}: ${out.rows.sun.length} rows per body`);
}
