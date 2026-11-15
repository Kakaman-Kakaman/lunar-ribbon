// Sunlight and Earth view around a site (version 2, engine/areaMap.ts): the share of a chosen period
// with the Sun's or Earth's centre above the skyline, at every point of a lattice around the site,
// from skylines precomputed by pipeline/build-area-maps.ts. Computed in a worker. Clicking a point
// makes it plan B's site.

import { useEffect, useRef, useState } from 'react';
import { pointXY, type AreaGrid } from '../engine/areaMap';
import { xyToLL, type NestedGrid } from '../engine/raymarch';
import { traverse, pathLength, type TraverseSample, type XY } from '../engine/traverse';
import { FrameCache } from '../engine/visibility';
import { loadTerrain } from '../state/tiles';
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
  const [tool, setTool] = useState<'pick' | 'route'>('pick');
  const [route, setRoute] = useState<XY[]>([]);
  const [speed, setSpeed] = useState('0.1');
  const [trav, setTrav] = useState<TraverseSample[] | null>(null);
  const [travMsg, setTravMsg] = useState('');
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
    if (route.length) {
      const toPx = ([x, y]: XY) => [((x - grid.cx) / grid.spacingM + (n - 1) / 2 + 0.5) * px, ((grid.cy - y) / grid.spacingM + (n - 1) / 2 + 0.5) * px];
      g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--earth').trim();
      g.lineWidth = 2;
      g.beginPath();
      route.forEach((pt, k) => { const [a, b] = toPx(pt); if (k) g.lineTo(a, b); else g.moveTo(a, b); });
      g.stroke();
      g.fillStyle = g.strokeStyle;
      route.forEach((pt) => { const [a, b] = toPx(pt); g.beginPath(); g.arc(a, b, 3.5, 0, 2 * Math.PI); g.fill(); });
    }
  }, [grid, res, body, px, route]);

  const exactXY = (e: React.MouseEvent): XY | null => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r || !grid) return null;
    const fi = (e.clientX - r.left) / px - 0.5, fj = (e.clientY - r.top) / px - 0.5;
    return pointXY(grid, fi, fj);
  };

  async function drive() {
    if (!grid || route.length < 2) return;
    const v = Number(speed);
    if (!(v > 0 && v <= 5)) { setTravMsg('Speed must be between 0 and 5 m/s.'); return; }
    setTravMsg('Loading terrain and driving the route...');
    setTrav(null);
    const [fine10, fine20, far] = await Promise.all([loadTerrain(10, grid.cx, grid.cy, 12000), loadTerrain(20, grid.cx, grid.cy, 12000), loadTerrain(160, grid.cx, grid.cy, 60000)]);
    const grids: NestedGrid[] = [fine10 ?? fine20, far].filter((g) => g !== null).map((g) => ({ grid: g! }));
    if (!grids.length) { setTravMsg('No terrain tiles cover this area.'); return; }
    await new Promise((r) => setTimeout(r, 20));
    const t0 = performance.now();
    const out = traverse({ path: route, speedMps: v, startMs: landingMs, stepMs: HOUR, heightM, grids, azStepDeg: 1, maxKm: 60, maxSamples: Math.min(2000, Math.ceil(pathLength(route) / (v * 3600)) + 1) }, new FrameCache());
    setTrav(out);
    setTravMsg(`${out.length} hourly positions, ${(pathLength(route) / 1000).toFixed(2)} km, ${Math.round(performance.now() - t0)} ms.`);
  }

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
        <p className="mt-1 text-sm text-ink2">No area map for {site.name} yet. Area maps cover the south-pole sites with real terrain inside 80° S.</p>
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
              onClick={(e) => {
                if (tool === 'route') { const xy = exactXY(e); if (xy) { setRoute((r) => [...r, xy]); setTrav(null); } return; }
                const p = cellAt(e); if (p !== null) onPickB(...llOf(p));
              }}
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
              <div className="space-y-2 border-t border-line pt-2">
                <p className="font-semibold text-ink">Click on the map to</p>
                <div className="flex flex-wrap gap-2">
                  {(['pick', 'route'] as const).map((t) => (
                    <button key={t} type="button" aria-pressed={tool === t} onClick={() => setTool(t)} className={`rounded-md border px-2.5 py-1 ${tool === t ? 'border-ink2 text-ink' : 'border-line text-ink2'}`}>
                      {t === 'pick' ? "Pick plan B's site" : 'Draw a rover route'}
                    </button>
                  ))}
                </div>
                {tool === 'route' && (
                  <div className="space-y-2">
                    <p>{route.length < 2 ? 'Click two or more points on the map.' : `${route.length} points, ${(pathLength(route) / 1000).toFixed(2)} km.`}</p>
                    <label className="flex items-center gap-2">Speed <input id="rover-speed" value={speed} onChange={(e) => setSpeed(e.target.value)} inputMode="decimal" className="w-16" /> m/s</label>
                    <div className="flex gap-2">
                      <button type="button" disabled={route.length < 2} onClick={drive} className="rounded-md border border-[#454b57] px-2.5 py-1 text-ink disabled:opacity-50">Drive it from plan A&apos;s landing</button>
                      <button type="button" onClick={() => { setRoute([]); setTrav(null); setTravMsg(''); }} className="rounded-md border border-line px-2.5 py-1">Clear</button>
                    </div>
                    {travMsg && <p aria-live="polite">{travMsg}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>
          {trav && <TraverseTracks samples={trav} />}
        </>
      )}
    </section>
  );
}

/** Tracks along a traverse: Sun visible, Earth in view, ground slope, by hour. */
function TraverseTracks({ samples }: { samples: TraverseSample[] }) {
  const W = 760, L = 70, R = 10, n = samples.length;
  const x = (k: number) => L + (k / Math.max(1, n)) * (W - L - R);
  const maxSlope = Math.max(10, ...samples.map((s) => (Number.isNaN(s.slopeDeg) ? 0 : s.slopeDeg)));
  const sY = (d: number) => 96 - (d / maxSlope) * 40;
  const bw = Math.max(1, (W - L - R) / Math.max(1, n) - 0.4);
  return (
    <div className="mt-3 overflow-x-auto">
      <p className="mb-1 text-[13px] font-semibold text-ink">Along the route, hour by hour from plan A&apos;s landing</p>
      <svg width={W} height={124} viewBox={`0 0 ${W} 124`} role="img" aria-label="Sun visibility, Earth in view and slope along the rover route">
        <text x={L - 6} y={14} textAnchor="end" fontSize="11" fill="var(--text2)">Sun</text>
        {samples.map((s, k) => <rect key={`s${k}`} x={x(k)} y={4} width={bw} height={14} fill={s.sunFrac >= 0.5 ? 'var(--sun)' : 'var(--alert)'} fillOpacity={s.sunFrac >= 0.5 ? 0.3 + 0.6 * s.sunFrac : 0.85} />)}
        <text x={L - 6} y={34} textAnchor="end" fontSize="11" fill="var(--text2)">Earth</text>
        {samples.map((s, k) => <rect key={`e${k}`} x={x(k)} y={24} width={bw} height={14} fill={s.earthFrac >= 0.5 ? 'var(--earth)' : 'var(--line)'} />)}
        <text x={L - 6} y={60} textAnchor="end" fontSize="11" fill="var(--text2)">Slope</text>
        <line x1={L} x2={W - R} y1={96} y2={96} stroke="var(--line)" />
        <text x={L - 6} y={99} textAnchor="end" fontSize="10.5" fill="var(--text2)" className="mono">0°</text>
        <text x={L - 6} y={sY(maxSlope) + 4} textAnchor="end" fontSize="10.5" fill="var(--text2)" className="mono">{Math.round(maxSlope)}°</text>
        <path d={'M' + samples.map((s, k) => `${x(k).toFixed(1)},${sY(Number.isNaN(s.slopeDeg) ? 0 : s.slopeDeg).toFixed(1)}`).join('L')} fill="none" stroke="var(--text)" strokeWidth="1.5" />
        <text x={L} y={118} fontSize="10.5" fill="var(--text2)" className="mono">0 h</text>
        <text x={W - R} y={118} textAnchor="end" fontSize="10.5" fill="var(--text2)" className="mono">{n - 1} h · {(samples[n - 1].distM / 1000).toFixed(2)} km</text>
      </svg>
      <p className="text-xs text-ink2">Each hour the rover&apos;s skyline is recomputed from the terrain tiles at its position (fine terrain near, 160 m beyond). Red: less than half of the Sun visible. Slope from the finest terrain at each point.</p>
    </div>
  );
}
