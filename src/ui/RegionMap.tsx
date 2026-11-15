// Sunlight and Earth view around a site (version 2, engine/areaMap.ts): the share of a chosen period
// with the Sun's or Earth's centre above the skyline, at every point of a lattice around the site,
// from skylines precomputed by pipeline/build-area-maps.ts. Computed in a worker. Clicking a point
// makes it plan B's site.

import { useEffect, useRef, useState } from 'react';
import { pointXY, type AreaGrid } from '../engine/areaMap';
import { xyToLL } from '../engine/raymarch';
import { fmtDateUtc } from '../engine/verdict';
import type { SiteInfo } from '../state/sites';

const base = () => import.meta.env.BASE_URL;
const HOUR = 3600000;
type Period = 'stay' | 'lunar-day' | 'year';
type Body = 'sun' | 'earth';

let worker: Worker | null = null;
let nextId = 1;
function compute(grid: AreaGrid, startMs: number, stepMs: number, n: number): Promise<{ sun: Float32Array; earth: Float32Array; ms: number }> {
  worker ??= new Worker(new URL('../state/areaWorker.ts', import.meta.url), { type: 'module' });
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const w = worker!;
    const on = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', on);
      if (e.data.ok) resolve(e.data); else reject(new Error(e.data.error));
    };
    w.addEventListener('message', on);
    w.postMessage({ id, grid, startMs, stepMs, n });
  });
}

interface Props {
  site: SiteInfo | undefined;
  heightM: number;
  landingMs: number;
  stayDays: number;
  onPickB(lat: number, lon: number): void;
}

export function RegionMap({ site, heightM, landingMs, stayDays, onPickB }: Props) {
  const [index, setIndex] = useState<{ regions: { id: string; heightsM: number[]; n: number; spacingM: number }[] } | null>(null);
  const [grid, setGrid] = useState<AreaGrid | null>(null);
  const [period, setPeriod] = useState<Period>('stay');
  const [body, setBody] = useState<Body>('sun');
  const [res, setRes] = useState<{ sun: Float32Array; earth: Float32Array; ms: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch(`${base()}area/index.json`).then((r) => (r.ok ? r.json() : null)).then(setIndex).catch(() => setIndex(null));
  }, []);
  const region = site && index ? index.regions.find((r) => r.id === site.id) : undefined;
  const useH = region ? region.heightsM.reduce((a, b) => (Math.abs(b - heightM) < Math.abs(a - heightM) ? b : a)) : null;

  useEffect(() => {
    setGrid(null);
    setRes(null);
    if (!region || useH === null) return;
    fetch(`${base()}area/${region.id}_${useH}m.json`).then((r) => r.json()).then(setGrid).catch(() => setGrid(null));
  }, [region?.id, useH]);

  const span = period === 'stay' ? { start: landingMs, step: HOUR, n: Math.max(1, Math.round(stayDays * 24)) }
    : period === 'lunar-day' ? { start: landingMs, step: 2 * HOUR, n: Math.round((29.53 * 24) / 2) }
    : { start: landingMs, step: 6 * HOUR, n: 4 * 365 };

  useEffect(() => {
    if (!grid) return;
    let live = true;
    setBusy(true);
    compute(grid, span.start, span.step, span.n).then((r) => { if (live) { setRes(r); setBusy(false); } }).catch(() => live && setBusy(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, period, landingMs, stayDays]);

  const px = grid ? Math.max(3, Math.floor(420 / grid.n)) : 4;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !grid || !res) return;
    const n = grid.n, dpr = window.devicePixelRatio || 1;
    c.width = n * px * dpr; c.height = n * px * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const v = body === 'sun' ? res.sun : res.earth;
    const lo = [20, 23, 28], hi = body === 'sun' ? [255, 176, 32] : [77, 163, 255];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const t = Math.pow(v[j * n + i], 0.8);
      g.fillStyle = `rgb(${lo.map((x, k) => Math.round(x + (hi[k] - x) * t)).join(',')})`;
      g.fillRect(i * px, j * px, px, px);
    }
    const m = (n * px) / 2;
    g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(m - 8, m); g.lineTo(m + 8, m); g.moveTo(m, m - 8); g.lineTo(m, m + 8); g.stroke();
  }, [grid, res, body, px]);

  const cellAt = (e: React.MouseEvent) => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r || !grid) return null;
    const i = Math.floor((e.clientX - r.left) / px), j = Math.floor((e.clientY - r.top) / px);
    return i >= 0 && j >= 0 && i < grid.n && j < grid.n ? j * grid.n + i : null;
  };
  const llOf = (p: number): [number, number] => {
    const i = p % grid!.n, j = Math.floor(p / grid!.n);
    return xyToLL(...pointXY(grid!, i, j));
  };
  const periodWord = period === 'stay' ? `plan A's ${stayDays}-day stay` : period === 'lunar-day' ? 'one lunar day from plan A\'s landing' : 'the year from plan A\'s landing';

  return (
    <section aria-labelledby="region-h" className="rounded-lg border border-line bg-panel px-4 py-3">
      <h2 id="region-h" className="text-base font-semibold">Around plan A&apos;s site</h2>
      {!site ? null : !index || !region ? (
        <p className="mt-1 text-sm text-ink2">No area map for {site.name} yet. Area maps cover the sites with real terrain inside 80° S.</p>
      ) : (
        <>
          <p className="mb-2 max-w-[100ch] text-xs text-ink2">
            Share of {periodWord} with the {body === 'sun' ? "Sun's" : "Earth's"} centre above the skyline, at {region.n * region.n} points {region.spacingM} m apart around {site.name} (cross), lander {useH} m up
            {useH !== heightM ? ` (the nearest height with an area map to the ${heightM} m chosen)` : ''}. Click a point to make it plan B&apos;s site.
          </p>
          <div className="mb-2 flex flex-wrap gap-2 text-[13px]">
            {(['stay', 'lunar-day', 'year'] as Period[]).map((p) => (
              <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)} className={`rounded-md border px-2.5 py-1 ${period === p ? 'border-ink2 text-ink' : 'border-line text-ink2'}`}>
                {p === 'stay' ? 'This stay' : p === 'lunar-day' ? 'One lunar day' : 'One year'}
              </button>
            ))}
            <span className="w-3" />
            {(['sun', 'earth'] as Body[]).map((b) => (
              <button key={b} type="button" aria-pressed={body === b} onClick={() => setBody(b)} className={`rounded-md border px-2.5 py-1 ${body === b ? 'border-ink2 text-ink' : 'border-line text-ink2'}`}>
                {b === 'sun' ? 'Sunlight' : 'Earth in view'}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-start gap-4">
            <canvas
              ref={canvas} style={{ width: (grid?.n ?? 0) * px, height: (grid?.n ?? 0) * px, cursor: 'crosshair', opacity: busy ? 0.5 : 1 }}
              role="img" aria-label={`Map of ${body === 'sun' ? 'sunlight' : 'Earth view'} share around ${site.name}`}
              onPointerMove={(e) => setHover(cellAt(e))} onPointerLeave={() => setHover(null)}
              onClick={(e) => { const p = cellAt(e); if (p !== null) onPickB(...llOf(p)); }}
            />
            <div className="min-w-0 max-w-[40ch] space-y-2 text-xs text-ink2">
              <p className="mono text-ink">
                {hover !== null && res && grid ? (() => {
                  const [la, lo] = llOf(hover);
                  const v = (body === 'sun' ? res.sun : res.earth)[hover];
                  return `${Math.round(v * 100)}% · ${Math.abs(la).toFixed(4)}° S, ${lo.toFixed(4)}°`;
                })() : busy ? 'Computing...' : res ? `${grid?.n}² points in ${Math.round(res.ms)} ms` : ' '}
              </p>
              <p>From {fmtDateUtc(span.start)}, {span.n} samples {span.step / HOUR} h apart.</p>
              <p>Drawn in the south polar plane: up the page is toward longitude 0°, right is toward 90° E.</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
