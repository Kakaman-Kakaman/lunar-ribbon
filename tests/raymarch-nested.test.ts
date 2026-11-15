import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_M, horizonProfile, llToXY, type DemGrid } from '../src/engine/raymarch.ts';

// Nested terrain: a fine grid inside a coarse one, on synthetic terrain with features of known
// size and place. The site is near the pole so pole-centred synthetic grids stay small.

const DEG = Math.PI / 180;
const SITE = { lat: -89.9, lon: 30 }; // about 3 km from the pole

/** A pole-centred square grid; `fill(x, y)` gives the height in metres at projected (x, y). */
function grid(size: number, scaleM: number, fill: (x: number, y: number) => number): DemGrid {
  const g: DemGrid = { data: new Int16Array(size * size), size, scaleM, dnToM: 0.5, offsetPx: (size - 1) / 2 };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      g.data[r * size + c] = Math.round(fill((c - g.offsetPx) * scaleM, (g.offsetPx - r) * scaleM) / 0.5);
    }
  }
  return g;
}

/** Projected point at distance d (m) and azimuth a (deg, clockwise from north) from the site. */
function at(azDeg: number, distM: number): [number, number] {
  const t = distM / MOON_RADIUS_M;
  const a = azDeg * DEG, la = SITE.lat * DEG;
  const s2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
  const lat2 = Math.asin(s2);
  const lon2 = SITE.lon * DEG + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * s2);
  return llToXY(lat2 / DEG, lon2 / DEG);
}

const pillarAt = (azDeg: number, distM: number, radiusM: number, heightM: number) => {
  const [px, py] = at(azDeg, distM);
  return (x: number, y: number) => (Math.hypot(x - px, y - py) <= radiusM ? heightM : 0);
};

const coarse = grid(301, 1000, () => 0); // 1 km pixels, 150 km to each side
const FINE_SIZE = 2001; // 10 m pixels, 10 km to each side of the pole: covers the site and 6 km around it
const base = { lat: SITE.lat, lon: SITE.lon, near: null, far: null };

describe('nested terrain', () => {
  // A 300 m pillar, 80 m across, 2 km away at azimuth 50: a 10 m grid holds it, a 1 km grid cannot.
  const fine = grid(FINE_SIZE, 10, pillarAt(50, 2000, 40, 300));

  it('sees a narrow peak in the fine grid that the coarse grid misses', () => {
    const coarseOnly = horizonProfile({ ...base, heightsM: [2], azStepDeg: 0.1, grids: [{ grid: coarse }] });
    const nested = horizonProfile({ ...base, heightsM: [2], azStepDeg: 0.1, grids: [{ grid: fine }, { grid: coarse }] });
    const ia = Math.round(50 / 0.1);
    const drop = 2000 ** 2 / (2 * MOON_RADIUS_M); // curvature drop over 2 km, about 1.15 m
    const expected = Math.atan((300 - 2 - drop) / 2000) / DEG;
    // The pillar's near face is up to 40 m closer than its centre, so allow a little above expected.
    expect(nested.horizonDeg[0][ia]).toBeGreaterThan(expected - 0.2);
    expect(nested.horizonDeg[0][ia]).toBeLessThan(expected + 0.4);
    expect(nested.distKm[0][ia]).toBeCloseTo(2.0, 1);
    expect(coarseOnly.horizonDeg[0][ia]).toBeLessThan(0);
  });

  it('respects maxKm: a fine grid limited to 1 km does not see the peak at 2 km', () => {
    const r = horizonProfile({ ...base, heightsM: [2], azStepDeg: 0.1, grids: [{ grid: fine, maxKm: 1 }, { grid: coarse }] });
    expect(r.horizonDeg[0][Math.round(50 / 0.1)]).toBeLessThan(0);
  });

  it('finds a peak narrower than the ray spacing only with fine azimuth steps', () => {
    // 24 m across at 6 km is 0.23 degrees, centred between the 0.5-degree rays at 50.0 and 50.5,
    // which pass 26 m from its centre, beyond the pillar plus one interpolation pixel.
    const thin = grid(FINE_SIZE, 10, pillarAt(50.25, 6000, 12, 300));
    const wide = horizonProfile({ ...base, heightsM: [2], azStepDeg: 0.5, grids: [{ grid: thin }, { grid: coarse }] });
    const narrow = horizonProfile({ ...base, heightsM: [2], azStepDeg: 0.1, grids: [{ grid: thin }, { grid: coarse }] });
    const peakNarrow = Math.max(...narrow.horizonDeg[0]);
    const peakWide = Math.max(...wide.horizonDeg[0]);
    expect(peakNarrow).toBeGreaterThan(2);
    expect(peakWide).toBeLessThan(0.5);
  });

  it('matches the geometric dip on a smooth sphere', () => {
    const flat = grid(FINE_SIZE, 10, () => 0);
    const r = horizonProfile({ ...base, heightsM: [2, 10], azStepDeg: 2, grids: [{ grid: flat }, { grid: coarse }] });
    const dip = (h: number) => -Math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + h)) / DEG;
    for (const v of r.horizonDeg[0]) expect(v).toBeCloseTo(dip(2), 2);
    for (const v of r.horizonDeg[1]) expect(v).toBeCloseTo(dip(10), 2);
  });

  it('leaves the original near/far recipe unchanged when no nested grids are given', () => {
    const a = horizonProfile({ lat: SITE.lat, lon: SITE.lon, heightsM: [2], near: fine, far: coarse, azStepDeg: 5 });
    const b = horizonProfile({ lat: SITE.lat, lon: SITE.lon, heightsM: [2], near: fine, far: coarse, azStepDeg: 5, grids: [] });
    expect(b.horizonDeg).toEqual(a.horizonDeg);
  });
});

describe('ridge layers', () => {
  const [SX, SY] = llToXY(SITE.lat, SITE.lon);
  const ring = (rM: number, halfWidthM: number, hM: number) => (x: number, y: number) =>
    Math.abs(Math.hypot(x - SX, y - SY) - rM) <= halfWidthM ? hM : 0;
  const both = (a: (x: number, y: number) => number, b: (x: number, y: number) => number) => (x: number, y: number) => Math.max(a(x, y), b(x, y));
  const drop = (d: number) => d ** 2 / (2 * MOON_RADIUS_M);
  const elev = (d: number, h: number) => Math.atan((h - 2 - drop(d)) / d) / DEG;

  it('returns a near low ridge and a far high ridge as two layers, skyline last', () => {
    const g = grid(FINE_SIZE, 10, both(ring(1000, 60, 50), ring(5000, 200, 400)));
    const r = horizonProfile({ ...base, heightsM: [2], azStepDeg: 10, grids: [{ grid: g }, { grid: coarse }], ridges: {} });
    for (const crestList of r.ridges![0]) {
      expect(crestList.length).toBe(2);
      const [[d1, e1], [d2, e2]] = crestList;
      expect(d1).toBeGreaterThan(0.9); expect(d1).toBeLessThan(1.1);
      expect(d2).toBeGreaterThan(4.7); expect(d2).toBeLessThan(5.3);
      expect(e1).toBeGreaterThan(elev(1060, 50) - 0.1); expect(e1).toBeLessThan(elev(940, 50) + 0.1);
      expect(e2).toBeGreaterThan(elev(5200, 400) - 0.1); expect(e2).toBeLessThan(elev(4800, 400) + 0.1);
    }
    expect(r.ridges![0][0].at(-1)![1]).toBeCloseTo(r.horizonDeg[0][0], 6);
  });

  it('drops a far ridge that a nearer, higher one hides', () => {
    const g = grid(FINE_SIZE, 10, both(ring(1000, 60, 300), ring(5000, 200, 400)));
    const r = horizonProfile({ ...base, heightsM: [2], azStepDeg: 10, grids: [{ grid: g }, { grid: coarse }], ridges: {} });
    for (const crestList of r.ridges![0]) {
      expect(crestList.length).toBe(1);
      expect(crestList[0][0]).toBeLessThan(1.1);
    }
  });

  it('returns no ridges unless asked', () => {
    const r = horizonProfile({ ...base, heightsM: [2], azStepDeg: 30, grids: [{ grid: coarse }] });
    expect(r.ridges).toBeUndefined();
  });
});
