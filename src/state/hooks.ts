// React hooks: the scenario with its URL hash, the site catalogue, and one plan's data.

import type { DsnSeries } from '../engine/dsn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HorizonMask } from '../engine/horizon';
import type { MissionProfile } from '../engine/mission';
import { getSeries, SCAN_DAYS } from './compute';
import { planView, scanFor, seriesGeometry, type PlanView, type SeriesGeometry } from './plan';
import {
  DAY_MS,
  LIMITS,
  clamp,
  decodeScenario,
  encodeScenario,
  landingBMs,
  withPreset,
  type BMode,
  type HeightM,
  type Scenario,
} from './scenario';
import { loadCatalog, loadMask, loadMaskV2, type SiteInfo } from './sites';
import type { MaskV2 } from '../engine/maskV2';
import type { SiteSeries } from '../engine/visibility';

// --- Scenario -------------------------------------------------------------------------

export interface Anchors {
  a: number;
  b: number;
}

export interface ScenarioApi {
  s: Scenario;
  anchors: Anchors;
  setSiteA(id: string): void;
  setSiteB(id: string): void;
  setProfile(id: string): void;
  setStay(v: number): void;
  setMaxDark(v: number): void;
  setMinEarth(v: number): void;
  setHeight(h: HeightM): void;
  /** fromStrip: moved by clicking the landing-date strip, so the scanned year stays put. */
  setLandingA(ms: number, fromStrip?: boolean): void;
  setBMode(m: BMode): void;
  setBPlus(days: number, fromStrip?: boolean): void;
  setBOwn(ms: number, fromStrip?: boolean): void;
  /** Move plan B's landing to an absolute time, whichever mode it is in. */
  setLandingB(ms: number, fromStrip?: boolean): void;
  replace(next: Scenario): void;
}

const HOUR = 3600000;
const snapHour = (ms: number) => Math.round(ms / HOUR) * HOUR;
const clampLanding = (ms: number) => clamp(snapHour(ms), LIMITS.landingMin, LIMITS.landingMax);

interface Core {
  s: Scenario;
  anchors: Anchors;
}

const coreOf = (s: Scenario): Core => ({ s, anchors: { a: s.landingMs, b: landingBMs(s) } });

export function useScenario(): ScenarioApi {
  const [core, setCore] = useState<Core>(() => coreOf(decodeScenario(window.location.hash)));
  const { s, anchors } = core;

  // Write the scenario to the URL hash.
  useEffect(() => {
    const h = '#' + encodeScenario(s);
    if (window.location.hash !== h) window.history.replaceState(null, '', h);
  }, [s]);

  // Follow hash edits made by hand or by following a shared link in the same tab.
  useEffect(() => {
    const onHash = () => {
      const next = decodeScenario(window.location.hash);
      setCore((cur) => (encodeScenario(cur.s) === encodeScenario(next) ? cur : coreOf(next)));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return useMemo<ScenarioApi>(() => {
    const patch = (f: (c: Scenario) => Scenario) => setCore((c) => ({ s: f(c.s), anchors: c.anchors }));
    return {
      s,
      anchors,
      replace: (next) => setCore(coreOf(next)),
      setSiteA: (id) => patch((c) => ({ ...c, siteA: id })),
      setSiteB: (id) => patch((c) => ({ ...c, siteB: id })),
      setProfile: (id) => patch((c) => withPreset(c, id)),
      setStay: (v) => patch((c) => ({ ...c, stayDays: clamp(v, LIMITS.stayDays.min, LIMITS.stayDays.max) })),
      setMaxDark: (v) => patch((c) => ({ ...c, maxDarkGapHours: clamp(v, 0, LIMITS.maxDarkGapHours.max) })),
      setMinEarth: (v) => patch((c) => ({ ...c, minEarthShare: clamp(v, 0, 1) })),
      setHeight: (h) => patch((c) => ({ ...c, heightM: h })),
      setLandingA: (ms, fromStrip = false) =>
        setCore((c) => {
          const next = { ...c.s, landingMs: clampLanding(ms) };
          if (fromStrip) return { s: next, anchors: c.anchors };
          return { s: next, anchors: { a: next.landingMs, b: next.bMode === 'own' ? c.anchors.b : landingBMs(next) } };
        }),
      setBMode: (m) =>
        setCore((c) => {
          const next = { ...c.s, bMode: m, bOwnMs: m === 'own' ? landingBMs(c.s) : c.s.bOwnMs };
          return { s: next, anchors: { ...c.anchors, b: landingBMs(next) } };
        }),
      setBPlus: (days, fromStrip = false) =>
        setCore((c) => {
          const next = { ...c.s, bPlusDays: clamp(Math.round(days * 4) / 4, 0, LIMITS.plusDays.max) };
          return { s: next, anchors: fromStrip ? c.anchors : { ...c.anchors, b: landingBMs(next) } };
        }),
      setBOwn: (ms, fromStrip = false) =>
        setCore((c) => {
          const t = clampLanding(ms);
          return { s: { ...c.s, bOwnMs: t }, anchors: fromStrip ? c.anchors : { ...c.anchors, b: t } };
        }),
      setLandingB: (ms, fromStrip = false) =>
        setCore((c) => {
          const t = clampLanding(ms);
          if (c.s.bMode === 'own') {
            return { s: { ...c.s, bOwnMs: t }, anchors: fromStrip ? c.anchors : { ...c.anchors, b: t } };
          }
          const days = clamp(Math.round(((t - c.s.landingMs) / DAY_MS) * 4) / 4, 0, LIMITS.plusDays.max);
          const next: Scenario = { ...c.s, bMode: 'plus', bPlusDays: days };
          return { s: next, anchors: fromStrip ? c.anchors : { ...c.anchors, b: landingBMs(next) } };
        }),
    };
  }, [s, anchors]);
}

/** A landing is served by an anchor only while it lies in the scanned year after it. */
export function effectiveAnchor(anchor: number, landing: number): number {
  return landing >= anchor && landing < anchor + SCAN_DAYS * DAY_MS ? anchor : landing;
}

// --- Catalogue ------------------------------------------------------------------------

export type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; sites: SiteInfo[] };

export function useCatalog(): CatalogState {
  const [st, setSt] = useState<CatalogState>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    loadCatalog().then(
      (sites) => live && setSt({ status: 'ready', sites }),
      (e: unknown) => live && setSt({ status: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return st;
}

// --- One plan -------------------------------------------------------------------------

export interface PlanData {
  key: string;
  site: SiteInfo;
  mask: HorizonMask;
  /** The full version 2 skyline file (band points, ridge layers), when the site has one. */
  maskV2: MaskV2 | null;
  series: SiteSeries;
  dsn: DsnSeries;
  geom: SeriesGeometry;
  ms: number;
  inWorker: boolean;
}

export type PlanState =
  | { status: 'loading'; data: null; view: null; stale: false }
  | { status: 'error'; message: string; data: null; view: null; stale: false }
  | { status: 'ready'; data: PlanData; view: PlanView; stale: boolean };

/** Load the mask, compute the series (off the main thread), and derive the plan's view. */
export function usePlan(
  site: SiteInfo | undefined,
  heightM: number,
  anchorMs: number,
  landingMs: number,
  profile: MissionProfile,
  retry: number,
): PlanState {
  const key = site ? `${site.id}|${heightM}|${anchorMs}` : '';
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const lastGood = useRef<{ data: PlanData; view: PlanView } | null>(null);

  useEffect(() => {
    if (!site) return;
    let live = true;
    setError(null);
    (async () => {
      const mask = await loadMask(site);
      const v2 = loadMaskV2(site);
      const maskV2 = v2 ? await v2 : null;
      const r = await getSeries(mask, heightM, anchorMs);
      if (!live) return;
      setData({ key, site, mask, maskV2, series: r.series, dsn: r.dsn, geom: seriesGeometry(r.series), ms: r.ms, inWorker: r.inWorker });
    })().catch((e: unknown) => {
      if (live) setError({ key, message: e instanceof Error ? e.message : String(e) });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry]);

  const fresh = data && data.key === key ? data : null;
  // The year of landing dates depends only on the series and the rules, not on the chosen landing.
  const scan = useMemo(() => (fresh ? scanFor(fresh.series, profile, fresh.dsn) : null), [fresh, profile]);
  const view = useMemo(() => {
    if (!fresh || !scan) return null;
    return planView(fresh.mask, fresh.series, heightM, landingMs, profile, scan, fresh.dsn);
  }, [fresh, scan, heightM, landingMs, profile]);

  if (fresh && view) {
    lastGood.current = { data: fresh, view };
    return { status: 'ready', data: fresh, view, stale: false };
  }
  if (error && error.key === key) return { status: 'error', message: error.message, data: null, view: null, stale: false };
  if (lastGood.current) return { status: 'ready', data: lastGood.current.data, view: lastGood.current.view, stale: true };
  return { status: 'loading', data: null, view: null, stale: false };
}
