import { describe, expect, it } from 'vitest';
import { discFractionAbove, discFractionAboveSkyline } from '../src/engine/visibility.ts';

const STEP = 0.1;
const N = 3600;
const profileFrom = (f: (az: number) => number) => Array.from({ length: N }, (_, i) => f(i * STEP));

describe('disc fraction against a real skyline', () => {
  it('equals the flat-line formula when the skyline is flat', () => {
    const flat = profileFrom(() => 0.3);
    for (const el of [-1, 0, 0.1, 0.25, 0.3, 0.45, 0.6, 2]) {
      for (const r of [0.27, 0.95]) {
        expect(discFractionAboveSkyline(123.4, el, r, flat, STEP)).toBeCloseTo(discFractionAbove(el, r, 0.3), 10);
      }
    }
  });

  it('gives half a disc centred on a vertical terrain edge', () => {
    // Wall at +20 deg for azimuths below 180, -20 deg above. Table entries are interpolated
    // linearly, so the edge is a 0.1 deg ramp through 0 at 179.95; a disc centred there at 0 deg
    // sees a skyline antisymmetric about its centre, so exactly half of it is above.
    const wall = profileFrom((az) => (az < 179.95 ? 20 : -20));
    expect(discFractionAboveSkyline(179.95, 0, 0.27, wall, STEP)).toBeCloseTo(0.5, 10);
  });

  it('lets light through a notch narrower than the disc', () => {
    // A gap in a wall: open at 89.9, 90.0 and 90.1, interpolated to the wall by 89.8 and 90.2, so
    // about 0.3 deg wide; the Sun (0.53 deg wide) centred on it shows only the part in the gap.
    const notch = profileFrom((az) => (Math.abs(az - 90) < 0.11 ? -5 : 20));
    const f = discFractionAboveSkyline(90, 1, 0.27, notch, STEP);
    expect(f).toBeGreaterThan(0.2);
    expect(f).toBeLessThan(0.85);
    // The old centre-only rule calls this fully up.
    expect(discFractionAbove(1, 0.27, -5)).toBe(1);
  });

  it('is between 0 and 1 and monotonic in elevation', () => {
    const rough = profileFrom((az) => Math.sin(az * 7) * 0.8 + Math.sin(az * 31) * 0.3);
    let prev = -1;
    for (let el = -3; el <= 3; el += 0.05) {
      const f = discFractionAboveSkyline(200, el, 0.27, rough, STEP);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = f;
    }
  });
});
