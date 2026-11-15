import { describe, expect, it } from 'vitest';
import { customId, customSite, parseCustomId } from '../src/state/custom';
import { sunCoveredByEarth } from '../src/engine/visibility';

describe('custom points', () => {
  it('round-trips latitude and longitude through the id', () => {
    const id = customId(-89.46, -137.31);
    expect(id).toBe('pt:-89.4600,-137.3100');
    expect(parseCustomId(id)).toEqual({ lat: -89.46, lon: -137.31 });
  });

  it('rejects ids that are not valid points', () => {
    expect(parseCustomId('pgda-site23-malapert-massif')).toBeNull();
    expect(parseCustomId('pt:-91,0')).toBeNull();
    expect(parseCustomId('pt:-89,181')).toBeNull();
    expect(parseCustomId('pt:abc,1')).toBeNull();
  });

  it('uses the 480 m grid inside 80 S and a smooth sphere outside', () => {
    expect(customSite(customId(-85.5, 10))?.terrain).toBe('lola-480m');
    expect(customSite(customId(-80, 10))?.terrain).toBe('lola-480m');
    expect(customSite(customId(-79.9, 10))?.terrain).toBe('smooth-sphere');
    expect(customSite(customId(0, 0))?.terrain).toBe('smooth-sphere');
  });
});


describe('Earth crossing the Sun', () => {
  it('covers nothing when the discs are apart and everything when centred', () => {
    expect(sunCoveredByEarth(2, 0.27, 0.95)).toBe(0);
    expect(sunCoveredByEarth(0.1, 0.27, 0.95)).toBe(1);
  });
  it('covers more as the discs close', () => {
    const a = sunCoveredByEarth(1.15, 0.27, 0.95), b = sunCoveredByEarth(1.0, 0.27, 0.95), c = sunCoveredByEarth(0.8, 0.27, 0.95);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(1);
  });
});
