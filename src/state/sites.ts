// Site catalogue: the sites with real LOLA skylines first, then every other catalogue site
// with a smooth-sphere (no terrain) skyline.

import sitesJson from '../data/sites.json';
import { smoothSphereMask, type HorizonMask } from '../engine/horizon';
import { centreMask, terrainOfGrid, type MaskV2 } from '../engine/maskV2';
import type { TerrainSource } from '../engine/verdict';
import { CUSTOM_PREFIX, customMask } from './custom';

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
  'north-pole-feature': 'North pole features (IAU craters)',
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

/** Sites served from version 2 skyline files (public/masks-v2), by id. */
const v2Sites = new Set<string>();

/** Fetch the mask index and merge it with the 54-site catalogue. Real-terrain sites come first. */
export async function loadCatalog(): Promise<SiteInfo[]> {
  // Version 2 skyline files first (fine terrain, heights 1/2/5/10 m); version 1 as a fallback.
  let index: IndexEntry[];
  const v2 = await fetch(`${base()}masks-v2/index.json`).catch(() => null);
  if (v2 && v2.ok) {
    const j = (await v2.json()) as { sites: (Omit<IndexEntry, 'terrain'> & { finestGrid: string })[] };
    index = j.sites.map((e) => ({ ...e, terrain: terrainOfGrid(e.finestGrid) }));
    for (const e of index) v2Sites.add(e.id);
  } else {
    const res = await fetch(`${base()}masks/index.json`);
    if (!res.ok) throw new Error(`Could not load the terrain index (HTTP ${res.status}).`);
    index = (await res.json()) as IndexEntry[];
  }
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
const v2Cache = new Map<string, Promise<MaskV2>>();

/** The full version 2 skyline file of a site (band points, ridge layers), or null if it has none. */
export function loadMaskV2(site: SiteInfo): Promise<MaskV2> | null {
  if (!v2Sites.has(site.id)) return null;
  let p = v2Cache.get(site.id);
  if (!p) {
    p = fetch(`${base()}masks-v2/${site.id}.json`).then(async (r) => {
      if (!r.ok) throw new Error(`Could not load the terrain for ${site.name} (HTTP ${r.status}).`);
      return (await r.json()) as MaskV2;
    });
    p.catch(() => v2Cache.delete(site.id));
    v2Cache.set(site.id, p);
  }
  return p;
}

/** The skyline mask for a site: fetched if it has real terrain, a smooth sphere otherwise. */
export function loadMask(site: SiteInfo): Promise<HorizonMask> {
  let p = maskCache.get(site.id);
  if (!p) {
    if (site.id.startsWith(CUSTOM_PREFIX)) {
      p = customMask(site);
    } else if (site.terrain === 'smooth-sphere') {
      p = Promise.resolve(smoothSphereMask(site.id, site.name, site.lat, site.lon, [1, 2, 5, 10]));
    } else if (v2Sites.has(site.id)) {
      p = loadMaskV2(site)!.then((m) => centreMask(m, site.terrain));
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
