import { describe, expect, it } from 'vitest';
import { FrameCache, eclipseGapAnywhereDeg } from '../src/engine/visibility.ts';

// NASA lunar eclipse table 2021-2030 (F. Espenak, https://eclipse.gsfc.nasa.gov/LEdecade/LEdecade2021.html):
// date and Terrestrial Dynamical Time of greatest eclipse. TD runs about a minute ahead of UTC.
const NASA: [string, string][] = [
  ['2027-02-20T23:14:06', 'penumbral'], ['2027-07-18T16:04:09', 'penumbral'], ['2027-08-17T07:14:59', 'penumbral'],
  ['2028-01-12T04:14:13', 'partial'], ['2028-07-06T18:20:57', 'partial'], ['2028-12-31T16:53:15', 'total'],
  ['2029-06-26T03:23:22', 'total'], ['2029-12-20T22:43:12', 'total'], ['2030-06-15T18:34:34', 'partial'],
  ['2030-12-09T22:28:51', 'penumbral'],
];
const MIN = 60000;

describe('lunar eclipses anywhere on the Moon, against NASA', () => {
  const frames = new FrameCache();
  for (const [td, kind] of NASA) {
    it(`finds the ${kind} eclipse of ${td.slice(0, 10)} within 3 minutes of NASA's greatest eclipse`, () => {
      const t0 = Date.parse(td + 'Z');
      let best = Infinity, bestT = 0;
      for (let k = -360; k <= 360; k++) {
        const t = t0 + k * MIN;
        const g = eclipseGapAnywhereDeg(frames.get(t));
        if (g < best) { best = g; bestT = t; }
      }
      expect(best).toBeLessThan(0);
      expect(Math.abs(bestT - t0)).toBeLessThanOrEqual(3 * MIN);
    });
  }

  it('finds exactly NASA\'s three eclipses in 2027 and nothing else', () => {
    const start = Date.UTC(2027, 0, 1), step = 10 * MIN, n = 365 * 144;
    const days: string[] = [];
    let inside = false;
    for (let i = 0; i < n; i++) {
      const g = eclipseGapAnywhereDeg(frames.get(start + i * step));
      if (g < 0 && !inside) days.push(new Date(start + i * step).toISOString().slice(0, 10));
      inside = g < 0;
    }
    expect(days).toEqual(['2027-02-20', '2027-07-18', '2027-08-17']);
  });
});
