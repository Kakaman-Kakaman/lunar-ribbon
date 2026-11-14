// Checks the in-browser Sun/Earth engine against tables from NASA JPL Horizons.
// The fixtures are produced by `npm run fixtures` (pipeline/fetch-horizons.mjs).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moonFrame, siteBasis, skyPosition } from '../src/engine/ephemeris';

const DIR = join(__dirname, 'fixtures', 'horizons');
const D2R = Math.PI / 180;

interface Fixture {
  name: string;
  lon: number;
  lat: number;
  heightKm: number;
  rows: Record<'sun' | 'earth', [number, number, number][]>;
}

/** Angle between two directions given as azimuth/elevation, degrees. */
function separation(az1: number, el1: number, az2: number, el2: number) {
  const c =
    Math.sin(el1 * D2R) * Math.sin(el2 * D2R) +
    Math.cos(el1 * D2R) * Math.cos(el2 * D2R) * Math.cos((az1 - az2) * D2R);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D2R;
}

const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

describe('Sun and Earth direction from a lunar site, against JPL Horizons', () => {
  it('has fixtures to check', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fx of fixtures) {
    for (const body of ['sun', 'earth'] as const) {
      it(`${fx.name} ${body}: within 0.01 degrees`, () => {
        const site = siteBasis(fx.lon, fx.lat, fx.heightKm);
        let worstSep = 0;
        let worstEl = 0;
        for (const [ms, az, el] of fx.rows[body]) {
          const p = skyPosition(site, moonFrame(new Date(ms))[body]);
          worstSep = Math.max(worstSep, separation(p.az, p.el, az, el));
          worstEl = Math.max(worstEl, Math.abs(p.el - el));
        }
        console.log(`${fx.name} ${body}: n=${fx.rows[body].length} max separation ${worstSep.toFixed(4)} deg, max elevation error ${worstEl.toFixed(4)} deg`);
        expect(worstSep).toBeLessThan(0.01);
      });
    }
  }
});
