import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DSN_COMPLEXES, complexesInView, computeDsnSeries, contactSeries, moonElevationDeg } from '../src/engine/dsn.ts';

const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'horizons', 'dsn-moon-2027.json'), 'utf8')) as {
  rows: Record<string, [number, number, number][]>;
};

describe('Moon elevation at the DSN complexes', () => {
  for (const c of DSN_COMPLEXES) {
    it(`matches JPL Horizons at ${c.name} over a week, hourly`, () => {
      let worst = 0;
      for (const [ms, , el] of fx.rows[c.id]) worst = Math.max(worst, Math.abs(moonElevationDeg(c, ms) - el));
      // Reported, not tuned: the largest difference is printed by the run.
      console.log(`${c.id}: largest elevation difference from Horizons ${worst.toFixed(4)} deg over ${fx.rows[c.id].length} hours`);
      expect(worst).toBeLessThan(0.005); // measured 2026-11-15: 0.0007-0.0008 deg
    });
  }
});

describe('contact', () => {
  it('needs Earth in view and at least one complex above the limit', () => {
    const start = fx.rows.goldstone[0][0];
    const d = computeDsnSeries(start, 3600000, 168);
    // At every hour some complex should see the Moon above 6 degrees most of the time, but not
    // always: count hours with none, and check the contact logic against the bit mask.
    let none = 0;
    for (let i = 0; i < d.n; i++) if (complexesInView(d, i) === 0) none++;
    console.log(`hours with no complex above 6 deg: ${none} of ${d.n}`);
    const allEarth = contactSeries(new Float32Array(d.n).fill(1), d);
    const noEarth = contactSeries(new Float32Array(d.n).fill(0), d);
    for (let i = 0; i < d.n; i++) {
      expect(allEarth[i]).toBe(complexesInView(d, i) === 0 ? 0 : 1);
      expect(noEarth[i]).toBe(0);
    }
  });
});
