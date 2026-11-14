import { describe, expect, it } from 'vitest';
import {
  MOON_RADIUS_M,
  horizonProfile,
  llToXY,
  sampleDem,
  xyToLL,
  type DemGrid,
} from '../src/engine/raymarch.ts';

const DEG = Math.PI / 180;

/** Great-circle destination, same formula as the engine. */
function destination(lat: number, lon: number, azDeg: number, distM: number): [number, number] {
  const t = distM / MOON_RADIUS_M;
  const a = azDeg * DEG;
  const la = lat * DEG;
  const sl2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
  const lat2 = Math.asin(sl2);
  const lon2 =
    lon * DEG + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * sl2);
  return [lat2 / DEG, lon2 / DEG];
}

const SIZE = 1201;
function makeGrid(fill: (x: number, y: number) => number): DemGrid {
  const g: DemGrid = {
    data: new Int16Array(SIZE * SIZE),
    size: SIZE,
    scaleM: 500,
    dnToM: 1,
    offsetPx: (SIZE - 1) / 2,
  };
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const x = (c - g.offsetPx) * g.scaleM;
      const y = (g.offsetPx - r) * g.scaleM;
      g.data[r * SIZE + c] = Math.round(fill(x, y));
    }
  }
  return g;
}

function argmax(a: number[]): number {
  let b = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i;
  return b;
}

describe('projection', () => {
  it('round-trips lat/lon', () => {
    for (const [lat, lon] of [[-85, 30], [-89.5, -137.5], [-80.1, 179.5], [-86, -0.2]]) {
      const [x, y] = llToXY(lat, lon);
      const [la, lo] = xyToLL(x, y);
      expect(la).toBeCloseTo(lat, 9);
      expect(lo).toBeCloseTo(lon, 9);
    }
  });
  it('puts lon 0 at +y, 90E at +x, pole at origin', () => {
    const [x0, y0] = llToXY(-85, 0);
    expect(Math.abs(x0)).toBeLessThan(1e-6);
    expect(y0).toBeGreaterThan(0);
    const [x9, y9] = llToXY(-85, 90);
    expect(x9).toBeGreaterThan(0);
    expect(Math.abs(y9)).toBeLessThan(1e-6);
    const [xp, yp] = llToXY(-90, 0);
    expect(xp).toBeCloseTo(0, 6);
    expect(yp).toBeCloseTo(0, 6);
  });
  it('80S sits at 2R tan(5 deg) from the pole', () => {
    const [x, y] = llToXY(-80, 0);
    expect(Math.hypot(x, y)).toBeCloseTo(2 * MOON_RADIUS_M * Math.tan(5 * DEG), 3);
  });
});

describe('sampleDem', () => {
  it('is bilinear and NaN outside', () => {
    const g = makeGrid((x) => x / 100);
    expect(sampleDem(g, 250, 0)).toBeCloseTo(2.5, 6);
    expect(Number.isNaN(sampleDem(g, 1e7, 0))).toBe(true);
  });
});

describe('horizonProfile', () => {
  const LAT = -85;
  const LON = 30;
  it('flat grid gives the smooth-sphere dip at every azimuth', () => {
    const flat = makeGrid(() => 0);
    const r = horizonProfile({ lat: LAT, lon: LON, heightsM: [2, 10], near: null, far: flat, azStepDeg: 2 });
    const dip = (h: number) => -Math.acos(MOON_RADIUS_M / (MOON_RADIUS_M + h)) / DEG;
    expect(dip(2)).toBeCloseTo(-0.087, 2);
    expect(dip(10)).toBeCloseTo(-0.194, 2);
    for (const v of r.horizonDeg[0]) expect(Math.abs(v - dip(2))).toBeLessThan(0.01);
    for (const v of r.horizonDeg[1]) expect(Math.abs(v - dip(10))).toBeLessThan(0.01);
  });
  it('null grids behave as a smooth sphere', () => {
    const r = horizonProfile({ lat: LAT, lon: LON, heightsM: [2], near: null, far: null, azStepDeg: 10 });
    for (const v of r.horizonDeg[0]) expect(Math.abs(v + 0.087)).toBeLessThan(0.01);
  });
  for (const [name, az] of [['north', 0], ['east', 90], ['south-west', 225]] as const) {
    it(`skyline peaks at azimuth ${az} for a mountain due ${name}`, () => {
      const [mlat, mlon] = destination(LAT, LON, az, 10000);
      const [mx, my] = llToXY(mlat, mlon);
      const grid = makeGrid((x, y) => 2000 * Math.exp(-((x - mx) ** 2 + (y - my) ** 2) / (2 * 2000 ** 2)));
      const r = horizonProfile({ lat: LAT, lon: LON, heightsM: [2], near: null, far: grid, azStepDeg: 0.5 });
      const peakAz = argmax(r.horizonDeg[0]) * 0.5;
      const diff = Math.min(Math.abs(peakAz - az), 360 - Math.abs(peakAz - az));
      expect(diff).toBeLessThanOrEqual(1);
      expect(r.horizonDeg[0][argmax(r.horizonDeg[0])]).toBeGreaterThan(5);
      expect(r.distKm[0][argmax(r.horizonDeg[0])]).toBeGreaterThan(5);
    });
  }
});
