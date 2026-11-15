import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_M, horizonProfile, llToXY, xyToLL, type DemGrid } from '../src/engine/raymarch.ts';

const DEG = Math.PI / 180;
const SITE = { lat: 89.9, lon: -40 };

function grid(size: number, scaleM: number, fill: (x: number, y: number) => number, pole: 'north' | 'south' = 'north'): DemGrid {
  const g: DemGrid = { pole, data: new Int16Array(size * size), size, scaleM, dnToM: 0.5, offsetPx: (size - 1) / 2 };
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) g.data[r * size + c] = Math.round(fill((c - g.offsetPx) * scaleM, (g.offsetPx - r) * scaleM) / 0.5);
  return g;
}
function at(azDeg: number, d: number): [number, number] {
  const t = d / MOON_RADIUS_M, a = azDeg * DEG, la = SITE.lat * DEG;
  const s2 = Math.sin(la) * Math.cos(t) + Math.cos(la) * Math.sin(t) * Math.cos(a);
  const lat2 = Math.asin(s2);
  const lon2 = SITE.lon * DEG + Math.atan2(Math.sin(a) * Math.sin(t) * Math.cos(la), Math.cos(t) - Math.sin(la) * s2);
  return llToXY(lat2 / DEG, lon2 / DEG, 'north');
}

describe('north polar stereographic', () => {
  it('round-trips and puts longitude 0 toward -y, 90 E toward +x', () => {
    for (const [lat, lon] of [[85, 30], [89.5, -137.5], [80.1, 179.5], [86, -0.2]]) {
      const [la, lo] = xyToLL(...llToXY(lat, lon, 'north'), 'north');
      expect(la).toBeCloseTo(lat, 9);
      expect(lo).toBeCloseTo(lon, 9);
    }
    const [x0, y0] = llToXY(85, 0, 'north');
    expect(Math.abs(x0)).toBeLessThan(1e-6);
    expect(y0).toBeLessThan(0);
    const [x90, y90] = llToXY(85, 90, 'north');
    expect(x90).toBeGreaterThan(0);
    expect(Math.abs(y90)).toBeLessThan(1e-6);
  });

  it('finds a pillar at the right azimuth and height on a north grid', () => {
    const [px, py] = at(120, 2000);
    const g = grid(1201, 10, (x, y) => (Math.hypot(x - px, y - py) <= 40 ? 300 : 0));
    const coarse = grid(301, 1000, () => 0);
    const r = horizonProfile({ lat: SITE.lat, lon: SITE.lon, heightsM: [2], near: null, far: null, azStepDeg: 1, grids: [{ grid: g }, { grid: coarse }] });
    const ia = r.horizonDeg[0].indexOf(Math.max(...r.horizonDeg[0]));
    expect(Math.abs(ia - 120)).toBeLessThanOrEqual(1);
    const expected = Math.atan((300 - 2 - 2000 ** 2 / (2 * MOON_RADIUS_M)) / 2000) / DEG;
    expect(r.horizonDeg[0][ia]).toBeGreaterThan(expected - 0.2);
    expect(r.horizonDeg[0][ia]).toBeLessThan(expected + 0.6);
  });

  it('refuses to mix north and south grids in one skyline', () => {
    const n = grid(11, 1000, () => 0, 'north'), s = grid(11, 1000, () => 0, 'south');
    expect(() => horizonProfile({ lat: SITE.lat, lon: SITE.lon, heightsM: [2], near: null, far: null, grids: [{ grid: n }, { grid: s }] })).toThrow();
  });
});
