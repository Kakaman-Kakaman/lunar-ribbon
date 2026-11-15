// Client for the series worker, with a main-thread fallback if workers are unavailable.

import { FrameCache, computeSeries, type SiteSeries } from '../engine/visibility';
import { computeDsnSeries, type DsnSeries } from '../engine/dsn';
import type { HorizonMask } from '../engine/horizon';
import { DAY_MS, HOUR_MS } from './scenario';

export interface WorkerRequest {
  id: number;
  mask: HorizonMask;
  heightM: number;
  startMs: number;
  stepMs: number;
  n: number;
}
export type WorkerReply =
  | { id: number; ok: true; series: SiteSeries; dsn: DsnSeries; ms: number }
  | { id: number; ok: false; error: string };

/** Series run from this many days before the anchor landing... */
export const LEAD_DAYS = 30;
/** ...through this many days of landing dates after it... */
export const SCAN_DAYS = 365;
/** ...plus the longest stay the sliders allow. */
export const MAX_STAY_DAYS = 100;
export const STEP_MS = HOUR_MS;
export const SERIES_N = (LEAD_DAYS + SCAN_DAYS + MAX_STAY_DAYS) * 24 + 1;

export interface SeriesResult {
  series: SiteSeries;
  /** Moon elevation at the DSN complexes for the same hours (site-independent). */
  dsn: DsnSeries;
  /** Time the computation took, ms. */
  ms: number;
  inWorker: boolean;
}

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: SeriesResult) => void; reject: (e: Error) => void }>();
let fallbackFrames: FrameCache | null = null;

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./seriesWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve({ series: e.data.series, dsn: e.data.dsn, ms: e.data.ms, inWorker: true });
      else p.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      workerBroken = true;
      worker = null;
      for (const [, p] of pending) p.reject(new Error('worker failed'));
      pending.clear();
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Only the parts of a mask that computeSeries reads (keeps the message small). */
function slimMask(mask: HorizonMask, heightM: number): HorizonMask {
  return {
    id: mask.id,
    name: mask.name,
    lat: mask.lat,
    lon: mask.lon,
    groundElevM: mask.groundElevM,
    terrain: mask.terrain,
    azStepDeg: mask.azStepDeg,
    heightsM: [heightM],
    horizonDeg: { [String(heightM)]: mask.horizonDeg[String(heightM)] },
  };
}

const cache = new Map<string, Promise<SeriesResult>>();

/** The series for one site, observer height and anchor landing. Cached by those three. */
export function getSeries(mask: HorizonMask, heightM: number, anchorMs: number): Promise<SeriesResult> {
  const key = `${mask.id}|${heightM}|${anchorMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const startMs = anchorMs - LEAD_DAYS * DAY_MS;

  const runHere = (): Promise<SeriesResult> =>
    new Promise((resolve, reject) => {
      // Yield once so the loading state paints before the main thread is busy.
      setTimeout(() => {
        try {
          fallbackFrames ??= new FrameCache();
          const t0 = performance.now();
          const series = computeSeries(mask, heightM, startMs, STEP_MS, SERIES_N, fallbackFrames);
          const dsn = computeDsnSeries(startMs, STEP_MS, SERIES_N);
          resolve({ series, dsn, ms: performance.now() - t0, inWorker: false });
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }, 30);
    });

  const run = (): Promise<SeriesResult> => {
    const w = getWorker();
    if (!w) return runHere();
    return new Promise<SeriesResult>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const req: WorkerRequest = { id, mask: slimMask(mask, heightM), heightM, startMs, stepMs: STEP_MS, n: SERIES_N };
      w.postMessage(req);
    }).catch((err) => {
      if (workerBroken) return runHere();
      throw err;
    });
  };

  const p = run();
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  return p;
}
