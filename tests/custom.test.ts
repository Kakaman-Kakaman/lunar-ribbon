import { describe, expect, it } from 'vitest';
import { customId, customSite, parseCustomId } from '../src/state/custom';

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
