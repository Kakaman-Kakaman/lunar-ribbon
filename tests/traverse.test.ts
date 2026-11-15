import { describe, expect, it } from 'vitest';
import { smoothSphereMask } from '../src/engine/horizon.ts';
import { llToXY, type DemGrid } from '../src/engine/raymarch.ts';
import { pathLength, pointAlong, slopeAt, traverse } from '../src/engine/traverse.ts';
import { FrameCache, computeSeries } from '../src/engine/visibility.ts';

function grid(size: number, scaleM: number, f: (x: number, y: number) => number): DemGrid {
  const g: DemGrid = { data: new Float32Array(size * size), size, scaleM, dnToM: 1, offsetPx: (size - 1) / 2 };
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) g.data[r * size + c] = f((c - g.offsetPx) * scaleM, (g.offsetPx - r) * scaleM);
  return g;
}

describe('traverses', () => {
  it('measures a path and finds points along it', () => {
    const p: [number, number][] = [[0, 0], [300, 0], [300, 400]];
    expect(pathLength(p)).toBe(700);
    expect(pointAlong(p, 150)).toEqual([150, 0]);
    expect(pointAlong(p, 500)).toEqual([300, 200]);
    expect(pointAlong(p, 9999)).toEqual([300, 400]);
  });

  it('gets the slope of an inclined plane', () => {
    const g = grid(401, 20, (x) => 0.1 * x);
    expect(slopeAt([{ grid: g }], 100, -50)).toBeCloseTo((Math.atan(0.1) * 180) / Math.PI, 6);
  });

  it('sees what a fixed site sees when the rover stands still on smooth ground', () => {
    const [x, y] = llToXY(-89.5, 40);
    const flat = grid(801, 100, () => 0);
    const start = Date.UTC(2027, 9, 1), step = 6 * 3600000;
    const frames = new FrameCache();
    const t = traverse({ path: [[x, y]], speedMps: 0, startMs: start, stepMs: step, heightM: 2, grids: [{ grid: flat }], maxSamples: 20 }, frames);
    const ref = computeSeries(smoothSphereMask('s', 's', -89.5, 40, [2]), 2, start, step, 20, frames);
    for (let k = 0; k < 20; k++) {
      expect(t[k].sunEl).toBeCloseTo(ref.sunEl[k], 4);
      expect(t[k].sunFrac).toBeCloseTo(ref.sunFrac[k], 2);
      expect(t[k].slopeDeg).toBe(0);
    }
  });

  it('advances along the path at the given speed and stops at the end', () => {
    const [x, y] = llToXY(-89.5, 40);
    const flat = grid(801, 100, () => 0);
    const t = traverse({ path: [[x, y], [x + 1000, y]], speedMps: 0.1, startMs: 0, stepMs: 3600000, heightM: 1, grids: [{ grid: flat }], azStepDeg: 10 }, new FrameCache());
    expect(t.length).toBe(4); // 360 m an hour: 0, 360, 720, 1000
    expect(t.map((s) => Math.round(s.distM))).toEqual([0, 360, 720, 1000]);
    expect(t.at(-1)!.arrived).toBe(true);
  });
});
