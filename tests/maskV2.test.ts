import { describe, expect, it } from 'vitest';
import { centreMask, packInt16, ridgesOf, unpackInt16, type MaskV2 } from '../src/engine/maskV2.ts';

describe('version 2 skyline files', () => {
  it('round-trips 16-bit values through base64, clamping out-of-range ones', () => {
    const v = [0, 1, -1, 123, -4567, 32767, -32768, 40000, -40000];
    expect(Array.from(unpackInt16(packInt16(v)))).toEqual([0, 1, -1, 123, -4567, 32767, -32768, 32767, -32768]);
  });

  it('decodes skylines, distances and ridge layers to degrees and kilometres', () => {
    const h = [1.23, -0.5, 4.56];
    const m = {
      version: 2, id: 'x', name: 'x', lat: -89, lon: 10, group: 'g', terrain: ['t'], heightsM: [2],
      centre: {
        lat: -89, lon: 10, groundElevM: 100, azStepDeg: 120,
        horizon: { '2': packInt16(h.map((v) => v * 100)) },
        distance: { '2': packInt16([1.5, 20, 199.99].map((v) => v * 100)) },
        ridgeAzStepDeg: 120,
        ridgeCount: { '2': packInt16([2, 0, 1]) },
        ridges: { '2': packInt16([0.5, 0.2, 3, 1.23, 7, 4.56].map((v) => v * 100)) },
      },
      band: { radiusM: 10, roundingRadiusM: 2, azStepDeg: 120, points: [] },
      source: '', sourceQuality: '', note: '',
    } as MaskV2;
    const mask = centreMask(m);
    expect(mask.horizonDeg['2']).toEqual(h);
    expect(mask.distKm!['2']).toEqual([1.5, 20, 199.99]);
    expect(ridgesOf(m, 2)).toEqual([[[0.5, 0.2], [3, 1.23]], [], [[7, 4.56]]]);
  });
});
