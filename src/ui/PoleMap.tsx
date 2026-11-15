// A click-to-pick map of the lunar south pole: shaded relief from the 480 m NASA LOLA grid,
// south polar stereographic with longitude 0 at the top and 90° E to the right (the grid's own
// layout). The shading shows shape only; it is not the real lighting at any date.

import { useEffect, useRef, useState } from 'react';
import { llToXY, xyToLL, type DemGrid } from '../engine/raymarch';
import { COARSE_LIMIT_LAT, loadCoarseGrid } from '../state/custom';
import type { SiteInfo } from '../state/sites';

const SIZE = 360; // display size, CSS px

function shade(grid: DemGrid): ImageData {
  const n = grid.size, d = grid.data, k = grid.dnToM, s = grid.scaleM;
  const img = new ImageData(n, n);
  const ex = 3; // vertical exaggeration for the shading only
  const L = [-0.55, 0.55, 0.63];
  const lm = Math.hypot(L[0], L[1], L[2]);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const zl = d[r * n + Math.max(0, c - 1)], zr = d[r * n + Math.min(n - 1, c + 1)];
      const zu = d[Math.max(0, r - 1) * n + c], zd = d[Math.min(n - 1, r + 1) * n + c];
      const gx = ((zr - zl) * k) / (2 * s) * ex;
      const gy = ((zu - zd) * k) / (2 * s) * ex; // +y is up (row 0 at the top)
      const nm = Math.hypot(gx, gy, 1);
      const lit = Math.max(0, (-gx * L[0] - gy * L[1] + L[2]) / (nm * lm));
      const h = d[i] * k; // metres, roughly -5000..+7000 here
      const tone = Math.max(0, Math.min(1, (h + 5000) / 12000));
      const v = 28 + lit * 150 + tone * 45;
      img.data[4 * i] = v * 0.94;
      img.data[4 * i + 1] = v * 0.96;
      img.data[4 * i + 2] = v;
      img.data[4 * i + 3] = 255;
    }
  }
  return img;
}

export function PoleMap(props: { sites: SiteInfo[]; current: SiteInfo | undefined; onPick(lat: number, lon: number): void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [grid, setGrid] = useState<DemGrid | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<[number, number] | null>(null);

  useEffect(() => {
    let live = true;
    loadCoarseGrid().then(
      (g) => live && setGrid(g),
      (e) => live && setErr(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!grid || !canvas.current) return;
    canvas.current.width = grid.size;
    canvas.current.height = grid.size;
    canvas.current.getContext('2d')?.putImageData(shade(grid), 0, 0);
  }, [grid]);

  if (err) return <p role="alert" className="text-alert">{err}</p>;
  if (!grid) return <p className="text-ink2" role="status">Loading the south pole map (about 3 MB)...</p>;

  const toPx = (lat: number, lon: number): [number, number] => {
    const [x, y] = llToXY(lat, lon);
    return [((x / grid.scaleM + grid.offsetPx) / grid.size) * SIZE, ((grid.offsetPx - y / grid.scaleM) / grid.size) * SIZE];
  };
  const toLL = (px: number, py: number): [number, number] => {
    const col = (px / SIZE) * grid.size, row = (py / SIZE) * grid.size;
    return xyToLL((col - grid.offsetPx) * grid.scaleM, (grid.offsetPx - row) * grid.scaleM);
  };
  const at = (e: React.MouseEvent<SVGSVGElement>): [number, number] => {
    const b = e.currentTarget.getBoundingClientRect();
    return toLL(e.clientX - b.left, e.clientY - b.top);
  };
  const [cx, cy] = toPx(-90, 0);
  const ring = (lat: number) => Math.hypot(toPx(lat, 0)[0] - cx, toPx(lat, 0)[1] - cy);
  const polar = props.sites.filter((s) => s.lat <= COARSE_LIMIT_LAT && s.terrain !== 'smooth-sphere');
  const cur = props.current && props.current.lat <= COARSE_LIMIT_LAT ? toPx(props.current.lat, props.current.lon) : null;

  return (
    <div className="mt-1 flex flex-wrap items-start gap-3">
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} className="block rounded" aria-hidden="true" />
        <svg
          width={SIZE}
          height={SIZE}
          className="absolute inset-0 cursor-crosshair"
          role="img"
          aria-label="Map of the lunar south pole; click to set a point"
          onMouseMove={(e) => setHover(at(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const [lat, lon] = at(e);
            if (lat <= COARSE_LIMIT_LAT) props.onPick(Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4);
          }}
        >
          <defs>
            <mask id="inside80">
              <rect width={SIZE} height={SIZE} fill="white" />
              <circle cx={cx} cy={cy} r={ring(-80)} fill="black" />
            </mask>
          </defs>
          <rect width={SIZE} height={SIZE} fill="#0a0c10" opacity="0.75" mask="url(#inside80)" />
          {[-85, -88].map((lat) => (
            <circle key={lat} cx={cx} cy={cy} r={ring(lat)} fill="none" stroke="#f2f4f7" strokeOpacity="0.25" strokeDasharray="3 4" />
          ))}
          <circle cx={cx} cy={cy} r={ring(-80)} fill="none" stroke="#f2f4f7" strokeOpacity="0.45" />
          {[
            [0, '0°'],
            [90, '90° E'],
            [180, '180°'],
            [-90, '90° W'],
          ].map(([lon, t]) => {
            const [x, y] = toPx(-80.7, lon as number);
            const anchor = lon === 90 ? 'end' : lon === -90 ? 'start' : 'middle';
            return (
              <text key={t} x={x} y={lon === 0 ? y + 9 : lon === 180 ? y - 2 : y + 4} textAnchor={anchor} fontSize="11" fill="#f2f4f7" stroke="#0a0c10" strokeWidth="3" paintOrder="stroke">
                {t}
              </text>
            );
          })}
          {polar.map((s) => {
            const [x, y] = toPx(s.lat, s.lon);
            return (
              <circle key={s.id} cx={x} cy={y} r="3" fill="#f2f4f7" stroke="#0a0c10" strokeWidth="1.5">
                <title>{s.name}</title>
              </circle>
            );
          })}
          {cur && <circle cx={cur[0]} cy={cur[1]} r="6" fill="none" stroke="#ffb020" strokeWidth="2" />}
        </svg>
      </div>
      <div className="max-w-[18rem] text-ink2">
        <p>Click inside the 80° S circle to set this plan&apos;s point. White dots are sites with real terrain (hover for names); the yellow ring is the current site.</p>
        <p className="mt-1.5">Shaded relief from the 480 m NASA LOLA grid, lit from the upper left to show shape only. It is not the lighting on any date.</p>
        <p className="mono mt-1.5 text-ink">
          {hover ? `${Math.abs(hover[0]).toFixed(3)}° ${hover[0] < 0 ? 'S' : 'N'}, ${Math.abs(hover[1]).toFixed(3)}° ${hover[1] < 0 ? 'W' : 'E'}` : ' '}
        </p>
      </div>
    </div>
  );
}
