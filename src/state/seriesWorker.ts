// Web Worker: computes a Sun and Earth time series off the main thread.
// One FrameCache lives for the life of the worker, so a second plan (or another height, or a
// nearby landing date) reuses the Moon-frame vectors already computed for the same hours.

import { FrameCache, computeSeries } from '../engine/visibility';
import { computeDsnSeries, type DsnSeries } from '../engine/dsn';
import type { WorkerRequest, WorkerReply } from './compute';

let frames = new FrameCache();
// The DSN series depends only on the hours, not the site: keep the last few by start and length.
const dsnCache = new Map<string, DsnSeries>();
let framesSeen = 0;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerReply, transfer: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, mask, heightM, startMs, stepMs, n } = e.data;
  try {
    const t0 = performance.now();
    if (framesSeen > 60000) {
      frames = new FrameCache();
      framesSeen = 0;
    }
    framesSeen += n;
    const series = computeSeries(mask, heightM, startMs, stepMs, n, frames);
    const key = `${startMs}|${stepMs}|${n}`;
    let dsn = dsnCache.get(key);
    if (!dsn) {
      dsn = computeDsnSeries(startMs, stepMs, n);
      if (dsnCache.size > 3) dsnCache.delete(dsnCache.keys().next().value!);
      dsnCache.set(key, dsn);
    }
    const ms = performance.now() - t0;
    const transfer = [
      series.sunAz, series.sunEl, series.sunHorizon, series.sunFrac,
      series.earthAz, series.earthEl, series.earthHorizon, series.earthFrac,
    ].map((a) => a.buffer as ArrayBuffer);
    scope.postMessage({ id, ok: true, series, dsn, ms }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) }, []);
  }
};
