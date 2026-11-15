// Web Worker: Sun and Earth shares over an area lattice for a date range (engine/areaMap.ts).
import { shareMap, type AreaGrid } from '../engine/areaMap';
import { FrameCache } from '../engine/visibility';

const frames = new FrameCache();
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; grid: AreaGrid; startMs: number; stepMs: number; n: number }>) => void) | null;
  postMessage(msg: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, grid, startMs, stepMs, n } = e.data;
  try {
    const t0 = performance.now();
    const m = shareMap(grid, startMs, stepMs, n, frames);
    scope.postMessage({ id, ok: true, sun: m.sun, earth: m.earth, ms: performance.now() - t0 }, [m.sun.buffer, m.earth.buffer]);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
