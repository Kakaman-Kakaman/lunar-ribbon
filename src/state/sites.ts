// Site catalogue: the sites with real LOLA skylines first, then every other catalogue site
// with a smooth-sphere (no terrain) skyline.

import sitesJson from '../data/sites.json';
import { smoothSphereMask, type HorizonMask } from '../engine/horizon';
import type { TerrainSource } from '../engine/verdict';

export interface SiteInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  group: string;
  terrain: TerrainSource;
  groundElevM: number | null;
  note: string;
  source: string;
}

interface IndexEntry {
  id: string;
  name: string;
  lat: number;
  lon: number;
  group: string;
  terrain: TerrainSource;
  groundElevM: number | null;
  source: string;
  note: string;
}

interface CatalogSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
  group: string;
  note?: string;
  source?: string;
}

const base = () => import.meta.env.BASE_URL;

const GROUP_LABELS: Record<string, string> = {
  clps: 'CLPS and commercial landers',
  'south-pole-feature': 'South pole features',
  'study-site': 'NASA Goddard study sites',
  india: 'India (Chandrayaan)',
  apollo: 'Apollo',
  surveyor: 'Surveyor',
  luna: 'Luna and Lunokhod',
  china: 'China (Chang’e)',
  japan: 'Japan',
  other: 'Other',
};

export const groupLabel = (g: string) => GROUP_LABELS[g] ?? g;

/** Fetch the mask index and merge it with the 54-site catalogue. Real-terrain sites come first. */
export async function loadCatalog(): Promise<SiteInfo[]> {
  const res = await fetch(`${base()}masks/index.json`);
  if (!res.ok) throw new Error(`Could not load the terrain index (HTTP ${res.status}).`);
  const index = (await res.json()) as IndexEntry[];
  const real: SiteInfo[] = index.map((e) => ({
    id: e.id,
    name: e.name,
    lat: e.lat,
    lon: e.lon,
    group: e.group,
    terrain: e.terrain,
    groundElevM: e.groundElevM,
    note: e.note,
    source: e.source,
  }));
  const have = new Set(real.map((s) => s.id));
  const rest: SiteInfo[] = (sitesJson.sites as CatalogSite[])
    .filter((s) => !have.has(s.id))
    .map((s) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      group: s.group,
      terrain: 'smooth-sphere' as const,
      groundElevM: null,
      note: s.note ?? '',
      source: s.source ?? '',
    }));
  return [...real, ...rest];
}

const maskCache = new Map<string, Promise<HorizonMask>>();

/** The skyline mask for a site: fetched if it has real terrain, a smooth sphere otherwise. */
export function loadMask(site: SiteInfo): Promise<HorizonMask> {
  let p = maskCache.get(site.id);
  if (!p) {
    if (site.terrain === 'smooth-sphere') {
      p = Promise.resolve(smoothSphereMask(site.id, site.name, site.lat, site.lon, [2, 10]));
    } else {
      p = fetch(`${base()}masks/${site.id}.json`).then(async (r) => {
        if (!r.ok) throw new Error(`Could not load the terrain for ${site.name} (HTTP ${r.status}).`);
        return (await r.json()) as HorizonMask;
      });
    }
    p.catch(() => maskCache.delete(site.id));
    maskCache.set(site.id, p);
  }
  return p;
}
