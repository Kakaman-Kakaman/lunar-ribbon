// The ribbon: the 360-degree horizon unrolled into one strip.
//
// x is azimuth from -180 to +180 degrees with north in the centre, left to right clockwise (never
// mirrored). y is elevation, -8 to +12 degrees, the same for every plan. Layers, back to front:
// sky and gridlines, Sun band, Earth region, Sun path with day ticks, Earth path, terrain (opaque),
// dark spans, Sun and Earth markers.

import { useId, useMemo } from 'react';
import { horizonAt } from '../engine/horizon';
import type { Envelope } from '../engine/ribbonGeometry';
import { clearanceText, compassName, fmtDuration, fmtNum } from '../engine/verdict';
import type { PlanData } from '../state/hooks';
import type { PlanView, YRange } from '../state/plan';

export const PLOT_LEFT = 76;
export const PLOT_RIGHT = 16;
const TOP = 8;
type Anchor = 'start' | 'middle' | 'end';
type Spot = { x: number; y: number; anchor: Anchor };
type Box = { x0: number; x1: number; y0: number; y1: number };
const BOTTOM = 40;
/** Plot height in pixels when the page does not pick one (the plan panels size it to the window). */
export const DEFAULT_PLOT_H = 190;
export const ribbonHeight = (plotH: number) => TOP + plotH + BOTTOM;
export const RIBBON_HEIGHT = ribbonHeight(DEFAULT_PLOT_H);

/** Azimuth in 0..360 to the ribbon's -180..180 axis. */
export const displayAz = (az: number) => (az > 180 ? az - 360 : az);

export const verticalExaggeration = (plotW: number, r: YRange, plotH = DEFAULT_PLOT_H) => plotH / (r.max - r.min) / (plotW / 360);

/** "2027-09-13 to 2028-09-12 UTC": the period the Sun band and Earth region cover. */
export const periodText = (geom: { fromMs: number; toMs: number }) =>
  `${new Date(geom.fromMs).toISOString().slice(0, 10)} to ${new Date(geom.toMs).toISOString().slice(0, 10)} UTC`;

export const signed = (x: number, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}`;

interface Props {
  width: number;
  data: PlanData;
  view: PlanView;
  heightM: number;
  range: YRange;
  /** Absolute sample index of the time cursor. */
  cursorIdx: number;
  hoverAz: number | null;
  onHover(az: number | null): void;
  title: string;
  /** Height of the plot area in pixels. */
  plotH?: number;
}

type Pt = [number, number];

/** Split a run of points into polylines wherever the azimuth wraps or `breakAt` says so. */
function splitWrap(pts: { x: number; y: number; key?: number }[], maxJump: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (i > 0 && Math.abs(pts[i].x - pts[i - 1].x) > maxJump) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    cur.push([pts[i].x, pts[i].y]);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

const poly = (pts: Pt[]) => pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');

export function Ribbon({ width, data, view, heightM, range, cursorIdx, hoverAz, onHover, title, plotH }: Props) {
  const PLOT_H = plotH ?? DEFAULT_PLOT_H;
  const RIBBON_H = ribbonHeight(PLOT_H);
  const uid = useId().replace(/:/g, '');
  const { mask, series, geom } = data;
  const Y_MIN = range.min;
  const Y_MAX = range.max;
  const noEarth = geom.earthRise === 'never';
  const plotW = Math.max(200, width - PLOT_LEFT - PLOT_RIGHT);
  const plotB = TOP + PLOT_H;
  const xOf = (az: number) => PLOT_LEFT + ((displayAz(az) + 180) / 360) * plotW;
  const xDisp = (d: number) => PLOT_LEFT + ((d + 180) / 360) * plotW;
  const yOf = (el: number) => TOP + ((Y_MAX - el) / (Y_MAX - Y_MIN)) * PLOT_H;
  const exag = verticalExaggeration(plotW, range, PLOT_H);
  const profile = mask.horizonDeg[String(heightM)];

  // --- Terrain skyline, sampled every 0.5 degrees across the -180..180 axis ---
  const terrain = useMemo(() => {
    const pts: { d: number; el: number }[] = [];
    for (let d = -180; d <= 180; d += 0.5) pts.push({ d, el: horizonAt(profile, mask.azStepDeg, d) });
    return pts;
  }, [profile, mask.azStepDeg]);

  const terrainPath = useMemo(() => {
    const top = terrain.map((p) => `${xDisp(p.d).toFixed(1)},${yOf(Math.min(Y_MAX + 0.4, Math.max(Y_MIN - 1, p.el))).toFixed(1)}`);
    return `M${PLOT_LEFT},${plotB + 2} L${top.join(' L')} L${PLOT_LEFT + plotW},${plotB + 2} Z`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, plotW, PLOT_H, Y_MIN, Y_MAX]);
  const edgePath = useMemo(
    () => 'M' + terrain.map((p) => `${xDisp(p.d).toFixed(1)},${yOf(Math.min(Y_MAX + 0.4, Math.max(Y_MIN - 1, p.el))).toFixed(1)}`).join(' L'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terrain, plotW, PLOT_H, Y_MIN, Y_MAX],
  );

  // Where the terrain rises above the chart: runs, with the highest value in each.
  const clipped = useMemo(() => {
    const runs: { d0: number; d1: number; max: number; at: number }[] = [];
    let cur: { d0: number; d1: number; max: number; at: number } | null = null;
    for (const p of terrain) {
      if (p.el > Y_MAX) {
        if (!cur) cur = { d0: p.d, d1: p.d, max: p.el, at: p.d };
        cur.d1 = p.d;
        if (p.el > cur.max) {
          cur.max = p.el;
          cur.at = p.d;
        }
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
    return runs.filter((r) => r.d1 - r.d0 >= 1);
  }, [terrain]);

  // --- Sun band and Earth region ---
  const bandPaths = (env: Envelope, radiusDeg: number): string[] => {
    const runs: { x: number; lo: number; hi: number }[][] = [];
    let cur: { x: number; lo: number; hi: number }[] = [];
    for (let k = 0; k < 360; k++) {
      const bin = (180 + k) % 360;
      const lo = env.minEl[bin];
      const hi = env.maxEl[bin];
      if (Number.isNaN(lo) || Number.isNaN(hi)) {
        if (cur.length) runs.push(cur);
        cur = [];
        continue;
      }
      const c = bin + 0.5;
      cur.push({ x: xDisp(c > 180 ? c - 360 : c), lo: lo - radiusDeg, hi: hi + radiusDeg });
    }
    if (cur.length) runs.push(cur);
    const half = plotW / 360 / 2;
    return runs.map((r) => {
      const top = r.map((p, i) => `${(p.x - (i === 0 ? half : 0)).toFixed(1)},${yOf(p.hi).toFixed(1)}`);
      const bot = [...r].reverse().map((p, i) => `${(p.x + (i === 0 ? half : 0)).toFixed(1)},${yOf(p.lo).toFixed(1)}`);
      return `M${top.join(' L')} L${bot.join(' L')} Z`;
    });
  };
  const sunBand = useMemo(
    () => bandPaths(geom.sunBand, view.sunRadiusDeg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geom, view.sunRadiusDeg, plotW, PLOT_H, Y_MIN, Y_MAX],
  );
  const earthRegion = useMemo(
    () => bandPaths(geom.earthRegion, view.earthRadiusDeg),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geom, view.earthRadiusDeg, plotW, PLOT_H, Y_MIN, Y_MAX],
  );

  // --- Paths ---
  const stayEndMs = series.startMs + view.stayEndIdx * series.stepMs;
  const sunSegments = useMemo(() => {
    // Split by wrap, by up/hidden state, and by inside/after the stay.
    type Seg = { pts: Pt[]; up: boolean; after: boolean };
    const segs: Seg[] = [];
    let cur: Seg | null = null;
    let prev: { x: number; y: number } | null = null;
    for (const p of view.sunPath) {
      const up = p.frac >= 0.5;
      const after = p.ms >= stayEndMs;
      const pt = { x: xOf(p.az), y: yOf(p.el) };
      const wrapped = prev !== null && Math.abs(pt.x - prev.x) > plotW / 2;
      if (!cur || wrapped || cur.up !== up || cur.after !== after) {
        const keep: Pt[] = cur && !wrapped && prev ? [[prev.x, prev.y]] : [];
        if (cur && cur.pts.length > 1) segs.push(cur);
        cur = { pts: [...keep, [pt.x, pt.y]], up, after };
      } else {
        cur.pts.push([pt.x, pt.y]);
      }
      prev = pt;
    }
    if (cur && cur.pts.length > 1) segs.push(cur);
    return segs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.sunPath, plotW, stayEndMs, PLOT_H, Y_MIN, Y_MAX]);

  const earthSegments = useMemo(
    () => splitWrap(view.earthPath.map((p) => ({ x: xOf(p.az), y: yOf(p.el) })), plotW / 2),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.earthPath, plotW, PLOT_H, Y_MIN, Y_MAX],
  );

  // Direction chevron on the Sun path, half a day after landing.
  const chevron = useMemo(() => {
    const i = Math.min(12, view.sunPath.length - 2);
    if (i < 1) return null;
    const a = view.sunPath[i], b = view.sunPath[i + 1];
    const x0 = xOf(a.az), y0 = yOf(a.el), x1 = xOf(b.az), y1 = yOf(b.el);
    if (Math.abs(x1 - x0) > plotW / 2) return null;
    const ang = Math.atan2(y1 - y0, x1 - x0);
    return { x: x0, y: y0, deg: (ang * 180) / Math.PI };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.sunPath, plotW, PLOT_H, Y_MIN, Y_MAX]);

  // --- Dark spans: brackets in the lower part of the terrain ---
  // A span that runs past the end of the stay names both figures, so it matches the mission strip.
  const spanLabel = (sp: { startMs: number; endMs: number; days: number }) => {
    const total = `${fmtDuration(sp.days * 24)} dark`;
    if (sp.startMs < stayEndMs && sp.endMs > stayEndMs + series.stepMs) {
      return `${total} (${fmtDuration((stayEndMs - Math.max(sp.startMs, view.landingMs)) / 3600000)} in the stay)`;
    }
    return total;
  };
  const brackets = useMemo(() => {
    const out: { x0: number; x1: number; row: number; label: string; after: boolean }[] = [];
    view.spans.forEach((sp, idx) => {
      const i0 = Math.max(0, Math.ceil((sp.startMs - series.startMs) / series.stepMs));
      const i1 = Math.min(series.n - 1, Math.floor((sp.endMs - series.startMs) / series.stepMs));
      const azs: number[] = [sp.azStart];
      for (let i = i0; i <= i1; i++) azs.push(series.sunAz[i]);
      azs.push(sp.azEnd);
      const pieces = splitWrap(azs.map((a) => ({ x: xOf(a), y: 0 })), plotW / 2);
      const xs = pieces.length ? pieces : [[[xOf(sp.azStart), 0] as Pt]];
      const widths = xs.map((pc) => Math.max(...pc.map((p) => p[0])) - Math.min(...pc.map((p) => p[0])));
      const widest = widths.indexOf(Math.max(...widths));
      xs.forEach((pc, k) => {
        out.push({
          x0: Math.min(...pc.map((p) => p[0])),
          x1: Math.max(...pc.map((p) => p[0])),
          row: idx % 2,
          label: k === widest ? spanLabel(sp) : '',
          after: sp.startMs >= stayEndMs,
        });
      });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.spans, plotW, stayEndMs]);

  // --- Markers at the cursor ---
  const ci = Math.min(series.n - 1, Math.max(0, cursorIdx));
  const sunAz = series.sunAz[ci], sunEl = series.sunEl[ci], sunH = series.sunHorizon[ci], sunFrac = series.sunFrac[ci];
  const earthAz = series.earthAz[ci], earthEl = series.earthEl[ci], earthH = series.earthHorizon[ci], earthFrac = series.earthFrac[ci];
  const sunX = xOf(sunAz), earthX = xOf(earthAz);
  const clampY = (el: number) => Math.min(plotB - 4, Math.max(TOP + 4, yOf(el)));
  const sunY = clampY(sunEl), earthY = clampY(earthEl);
  const sunUp = sunFrac >= 0.5, earthUp = earthFrac >= 0.5;
  const rel = (el: number, h: number) => clearanceText(el - h);
  const sunLabel = `Sun ${rel(sunEl, sunH)}${sunUp ? '' : ', hidden'}`;
  const earthLabel = `Earth ${rel(earthEl, earthH)}${earthUp ? '' : ', hidden'}`;
  const labelAnchor = (x: number): Anchor => (x > PLOT_LEFT + plotW - 190 ? 'end' : x < PLOT_LEFT + 190 ? 'start' : 'middle');
  // Marker labels stay inside the plot and clear of each other. Each label can sit above, below,
  // right or left of its marker; the first pair that fits without colliding wins, so the usual
  // case (both above) is unchanged. An 11 px mono character is about 6.6 px wide, and a line runs
  // from 10 px above its baseline to 3 px below it.
  const labelBox = (text: string, s: Spot): Box => {
    const w = text.length * 6.6;
    const x0 = s.anchor === 'middle' ? s.x - w / 2 : s.anchor === 'end' ? s.x - w : s.x;
    return { x0, x1: x0 + w, y0: s.y - 10, y1: s.y + 3 };
  };
  const markBox = (x: number, y: number, r: number): Box => ({ x0: x - r, x1: x + r, y0: y - r, y1: y + r });
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const inside = (b: Box) => b.y0 >= TOP + 2 && b.y1 <= plotB - 2 && b.x0 >= PLOT_LEFT && b.x1 <= PLOT_LEFT + plotW;
  const spotsAround = (x: number, y: number, up: number, down: number): Spot[] => [
    { x, y: y - up, anchor: labelAnchor(x) },
    { x, y: y + down, anchor: labelAnchor(x) },
    { x: x + 14, y: y + 4, anchor: 'start' },
    { x: x - 14, y: y + 4, anchor: 'end' },
  ];
  const sunSpots = spotsAround(sunX, sunY, 22, 25);
  const earthSpots = spotsAround(earthX, earthY, 17, 22);
  const sunMark = markBox(sunX, sunY, 13), earthMark = markBox(earthX, earthY, 8);
  const labelSpots = (): [Spot, Spot] => {
    for (const s of sunSpots) {
      const sb = labelBox(sunLabel, s);
      if (!inside(sb) || (!noEarth && hit(sb, earthMark))) continue;
      if (noEarth) return [s, earthSpots[0]];
      for (const e of earthSpots) {
        const eb = labelBox(earthLabel, e);
        if (inside(eb) && !hit(eb, sb) && !hit(eb, sunMark)) return [s, e];
      }
    }
    return [
      sunSpots.find((s) => inside(labelBox(sunLabel, s))) ?? sunSpots[0],
      earthSpots.find((e) => inside(labelBox(earthLabel, e))) ?? earthSpots[0],
    ];
  };
  const [sunSpot, earthSpot] = labelSpots();

  // --- Hover ---
  const hoverX = hoverAz === null ? null : xOf(hoverAz);
  const hoverEl = hoverAz === null ? null : horizonAt(profile, mask.azStepDeg, hoverAz);

  const ticksX = [-180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150, 180];
  const cardinals: Record<number, string> = { [-180]: 'S', [-90]: 'W', 0: 'N', 90: 'E', 180: 'S' };
  const gridEls: number[] = [];
  for (let g = Math.ceil(Y_MIN / range.step) * range.step; g <= Y_MAX + 1e-9; g += range.step) gridEls.push(g);

  const sunPeriod = periodText(geom);

  return (
    <svg
      width={width}
      height={RIBBON_H}
      viewBox={`0 0 ${width} ${RIBBON_H}`}
      role="img"
      aria-labelledby={`${uid}t ${uid}d`}
      className="block select-none"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      <title id={`${uid}t`}>{title}</title>
      <desc id={`${uid}d`}>
        Horizon ribbon, azimuth from -180 to +180 degrees with north in the centre, elevation from {Y_MIN} to +{Y_MAX} degrees.
        The Sun band covers {sunPeriod}. At the cursor the Sun is {rel(sunEl, sunH)}{noEarth ? ' and Earth never rises at this site.' : ` and Earth is ${rel(earthEl, earthH)}.`}
      </desc>
      <defs>
        <clipPath id={`${uid}clip`}>
          <rect x={PLOT_LEFT} y={TOP} width={plotW} height={PLOT_H} />
        </clipPath>
        <pattern id={`${uid}hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="var(--dark)" />
          <line x1="0" y1="0" x2="0" y2="7" stroke="var(--text2)" strokeWidth="1.4" opacity="0.7" />
        </pattern>
      </defs>

      {/* 1. Sky and gridlines */}
      <rect x={PLOT_LEFT} y={TOP} width={plotW} height={PLOT_H} fill="var(--sky)" />
      {gridEls.map((e) => (
        <g key={e}>
          <line
            x1={PLOT_LEFT} x2={PLOT_LEFT + plotW} y1={yOf(e)} y2={yOf(e)}
            stroke={e === 0 ? 'var(--text2)' : 'var(--line)'}
            strokeWidth={e === 0 ? 1 : 0.8}
            strokeDasharray={e === 0 ? '5 4' : undefined}
            opacity={e === 0 ? 0.8 : 0.9}
          />
          <text x={PLOT_LEFT - 8} y={yOf(e) + 3.5} textAnchor="end" fontSize="11" fill="var(--text2)" className="mono">
            {e === 0 ? 'level 0°' : `${e > 0 ? '+' : '−'}${Math.abs(e)}°`}
          </text>
        </g>
      ))}
      {ticksX.map((d) => (
        <line key={d} x1={xDisp(d)} x2={xDisp(d)} y1={TOP} y2={plotB} stroke="var(--line)" strokeWidth="0.8" opacity={d === 0 ? 1 : 0.55} />
      ))}

      <g clipPath={`url(#${uid}clip)`}>
        {/* 2. Sun band */}
        {sunBand.map((d, i) => (
          <path key={`sb${i}`} d={d} fill="var(--sun)" fillOpacity="0.2" />
        ))}
        {/* 3. Earth region */}
        {!noEarth && earthRegion.map((d, i) => (
          <path key={`er${i}`} d={d} fill="var(--earth)" fillOpacity="0.28" />
        ))}
        {/* 4. Sun path and day ticks */}
        {sunSegments.map((sg, i) => (
          <polyline
            key={`sp${i}`}
            points={poly(sg.pts)}
            fill="none"
            stroke="var(--sun)"
            strokeWidth={sg.up ? 2 : 1.4}
            strokeDasharray={sg.up ? undefined : '1.5 4'}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={sg.up ? (sg.after ? 0.5 : 1) : 0.55}
          />
        ))}
        {view.ticks.map((t) => {
          const x = xOf(t.az), y = yOf(t.el);
          const after = t.ms >= stayEndMs;
          const numbered = t.day <= 29;
          return (
            <g key={`tk${t.day}`} opacity={after ? 0.6 : 1}>
              <line x1={x} x2={x} y1={y - 4} y2={y + 4} stroke="var(--sun)" strokeWidth="1.2" />
              {numbered && (
                <text x={x} y={y - 8} textAnchor="middle" fontSize="10" className="mono halo" fill="var(--sun)">
                  {t.day}
                </text>
              )}
            </g>
          );
        })}
        {chevron && (
          <path
            d="M-5,-4 L1,0 L-5,4"
            transform={`translate(${chevron.x + 0},${chevron.y}) rotate(${chevron.deg})`}
            fill="none" stroke="var(--sun)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
        )}
        {/* 5. Earth path */}
        {!noEarth && earthSegments.map((pts, i) => (
          <polyline key={`ep${i}`} points={poly(pts)} fill="none" stroke="var(--earth)" strokeWidth="1" opacity="0.9" strokeLinejoin="round" />
        ))}

        {/* 6. Terrain: opaque, over everything above */}
        <path d={terrainPath} fill="var(--terrain)" />
        <path d={edgePath} fill="none" stroke="var(--terrain-edge)" strokeWidth="1.4" strokeLinejoin="round" />
        {clipped.map((r, i) => {
          const x = xDisp(r.at);
          const cx = Math.min(PLOT_LEFT + plotW - 120, Math.max(PLOT_LEFT + 6, x - 50));
          return (
            <g key={`cl${i}`}>
              <path d={`M${x - 6},${TOP + 11} L${x},${TOP + 3} L${x + 6},${TOP + 11} Z`} fill="var(--terrain-edge)" />
              <text x={cx} y={TOP + 24} fontSize="10.5" fill="var(--text2)" className="mono">
                {`terrain rises to ${signed(r.max)}°`}
              </text>
            </g>
          );
        })}

        {/* 7. Dark spans */}
        {brackets.map((b, i) => {
          const y = plotB - 14 - b.row * 30;
          const w = Math.max(3, b.x1 - b.x0);
          return (
            <g key={`ds${i}`} opacity={b.after ? 0.6 : 1}>
              <rect x={b.x0} y={y - 6} width={w} height={12} fill={`url(#${uid}hatch)`} stroke="var(--text2)" strokeWidth="1" strokeDasharray={b.after ? '3 2' : undefined} />
              {b.label && (
                <text
                  x={b.x0 + w / 2} y={y - 11} textAnchor="middle" fontSize="11" className="mono halo-terrain" fill="var(--text)"
                >
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Hover guide */}
        {hoverX !== null && hoverEl !== null && (
          <g pointerEvents="none">
            <line x1={hoverX} x2={hoverX} y1={TOP} y2={plotB} stroke="var(--text)" strokeWidth="1" opacity="0.6" />
            <circle cx={hoverX} cy={Math.min(plotB, Math.max(TOP, yOf(hoverEl)))} r="3.5" fill="var(--terrain-edge)" stroke="var(--sky)" strokeWidth="1.5" />
          </g>
        )}

        {/* 8. Sun and Earth markers (symbols, not to scale) */}
        <g>
          <g transform={`translate(${sunX},${sunY})`}>
            {sunUp ? (
              <>
                {Array.from({ length: 8 }, (_, k) => (
                  <line key={k} x1="0" y1="-8.5" x2="0" y2="-12" stroke="var(--sun)" strokeWidth="1.8" transform={`rotate(${k * 45})`} strokeLinecap="round" />
                ))}
                <circle r="6" fill="var(--sun)" stroke="var(--sky)" strokeWidth="2" />
              </>
            ) : (
              <>
                <circle r="6" fill="var(--sky)" stroke="var(--sun)" strokeWidth="1.8" strokeDasharray="2.5 2" />
                <line x1="-4" y1="4" x2="4" y2="-4" stroke="var(--sun)" strokeWidth="1.5" />
              </>
            )}
          </g>
          {!noEarth && <g transform={`translate(${earthX},${earthY})`}>
            {earthUp ? (
              <>
                <circle r="6" fill="var(--earth)" stroke="var(--sky)" strokeWidth="2" />
                <ellipse rx="6" ry="2.4" fill="none" stroke="var(--sky)" strokeWidth="1.1" />
                <line x1="0" y1="-6" x2="0" y2="6" stroke="var(--sky)" strokeWidth="1.1" />
              </>
            ) : (
              <>
                <circle r="6" fill="var(--sky)" stroke="var(--earth)" strokeWidth="1.8" strokeDasharray="2.5 2" />
                <line x1="-4" y1="4" x2="4" y2="-4" stroke="var(--earth)" strokeWidth="1.5" />
              </>
            )}
          </g>}
          <text
            x={sunSpot.x} y={sunSpot.y} textAnchor={sunSpot.anchor} fontSize="11" className="mono halo" fill="var(--text)"
          >
            {sunLabel}
          </text>
          {!noEarth && <text
            x={earthSpot.x} y={earthSpot.y} textAnchor={earthSpot.anchor}
            fontSize="11" className="mono halo" fill="var(--text)"
          >
            {earthLabel}
          </text>}
          {noEarth && (
            <text x={PLOT_LEFT + plotW / 2} y={TOP + 22} textAnchor="middle" fontSize="12" fill="var(--earth)" className="halo">
              Earth never rises at this site in the period shown, so there is no Earth region or path to draw
            </text>
          )}
        </g>
      </g>

      {/* Plot frame */}
      <rect x={PLOT_LEFT} y={TOP} width={plotW} height={PLOT_H} fill="none" stroke="var(--line)" />

      {/* x axis: azimuth numbers, with the compass letter on the same row */}
      {ticksX.map((d) => (
        <g key={`xt${d}`}>
          <line x1={xDisp(d)} x2={xDisp(d)} y1={plotB} y2={plotB + 4} stroke="var(--text2)" />
          <text x={xDisp(d)} y={plotB + 17} textAnchor="middle" fontSize="11" fill="var(--text2)" className="mono">
            {cardinals[d] && (
              <tspan fontWeight="700" fontSize="12" fill="var(--text)" style={{ fontFamily: 'var(--font-sans)' }}>
                {cardinals[d]}{' '}
              </tspan>
            )}
            {d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0'}
          </text>
        </g>
      ))}
      <text x={PLOT_LEFT} y={plotB + 34} textAnchor="start" fontSize="11" fill="var(--text2)">
        Azimuth, degrees clockwise from north. Sun band and Earth region cover {sunPeriod}.
      </text>
      <text x={PLOT_LEFT + plotW} y={plotB + 34} textAnchor="end" fontSize="11" fill="var(--text2)" className="mono">
        elevation {'×'}{fmtNum(exag, exag >= 1 ? 1 : 2)} vs azimuth{range.fitted ? '; range fitted' : ''}
      </text>
      <text transform={`translate(13,${TOP + PLOT_H / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fill="var(--text2)">
        Elevation, degrees
      </text>

      {/* Pointer capture */}
      <rect
        x={PLOT_LEFT} y={TOP} width={plotW} height={PLOT_H} fill="transparent"
        onPointerMove={(e) => {
          const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
          const d = ((e.clientX - r.left) / r.width) * 360 - 180;
          onHover(((d % 360) + 360) % 360);
        }}
        onPointerLeave={() => onHover(null)}
      />
    </svg>
  );
}

export function hoverReadout(
  mask: PlanData['mask'],
  heightM: number,
  az: number,
): { az: string; skyline: string; dist: string } {
  const profile = mask.horizonDeg[String(heightM)];
  const el = horizonAt(profile, mask.azStepDeg, az);
  const dArr = mask.distKm?.[String(heightM)];
  let dist = mask.terrain === 'smooth-sphere' ? 'no terrain: geometric estimate' : 'distance not in this terrain file';
  if (dArr && dArr.length) {
    const i = Math.round(az / mask.azStepDeg) % dArr.length;
    const v = dArr[i];
    if (Number.isFinite(v)) dist = `terrain ${fmtNum(v, v < 10 ? 1 : 0)} km away`;
  }
  return {
    az: `${signed(displayAz(az), 1)}° (${compassName(az)})`,
    skyline: `skyline ${signed(el, 2)}° relative to level`,
    dist,
  };
}

/** Pixel position of an azimuth on a ribbon of the given width (used to place callouts). */
export const plotX = (width: number, az: number) =>
  PLOT_LEFT + ((displayAz(az) + 180) / 360) * Math.max(200, width - PLOT_LEFT - PLOT_RIGHT);

/** Pixel position of an elevation on a ribbon with the given range. */
export const plotY = (range: YRange, el: number) =>
  TOP + ((range.max - Math.min(range.max, Math.max(range.min, el))) / (range.max - range.min)) * DEFAULT_PLOT_H;
