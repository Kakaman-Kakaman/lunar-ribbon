// Landing-date strip: one cell per 6 hours of landing time for the next year, marked works, Sun
// fails, Earth fails or both. The chosen date, the slip margin and the next window are bracketed.
// Clicking or dragging moves the landing date.

import { useId, useMemo, useRef, useState } from 'react';
import { fmtDateShortUtc, fmtDateTimeUtc, fmtDuration } from '../engine/verdict';
import type { PlanView } from '../state/plan';
import { PLOT_LEFT, PLOT_RIGHT } from './Ribbon';

const HEIGHT = 104;
const LANE_Y = 22;
const LANE_H = 22;
const HOUR = 3600000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CODE_WORD = ['works', 'Sun fails', 'Earth fails', 'Sun and Earth fail', 'battery or contact fails'];

/** Words for a scan code: bits 1 Sun, 2 Earth, 4 battery or contact (version 2). */
function codeWord(code: number): string {
  const base = code & 3;
  if (base === 0) return code === 0 ? CODE_WORD[0] : CODE_WORD[4];
  return code & 4 ? `${CODE_WORD[base]}, and battery or contact` : CODE_WORD[base];
}

interface Props {
  width: number;
  view: PlanView;
  onPick(ms: number): void;
  label: string;
  /** Show the four cell states (once is enough when two strips are stacked). */
  showKey?: boolean;
}

/** The four cell states as small swatches, used by the strip and its legend. */
export function CellDefs({ uid }: { uid: string }) {
  return (
    <defs>
      <pattern id={`${uid}sun`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="var(--dark)" />
        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--sun)" strokeWidth="2.2" />
      </pattern>
      <pattern id={`${uid}earth`} width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="var(--dark)" />
        <line x1="0" y1="3" x2="6" y2="3" stroke="var(--earth)" strokeWidth="2.2" />
      </pattern>
      <pattern id={`${uid}both`} width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="var(--dark)" />
        <path d="M0,0 L6,6 M6,0 L0,6" stroke="var(--alert)" strokeWidth="1.6" />
      </pattern>
      <pattern id={`${uid}power`} width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="var(--dark)" />
        <circle cx="3" cy="3" r="1.4" fill="var(--text)" />
      </pattern>
    </defs>
  );
}

export const cellFill = (uid: string, code: number) => {
  const base = code & 3;
  if (code === 0) return 'var(--good)';
  if (base === 0) return `url(#${uid}power)`;
  return base === 1 ? `url(#${uid}sun)` : base === 2 ? `url(#${uid}earth)` : `url(#${uid}both)`;
};

export function LandingStrip({ width, view, onPick, label, showKey = true }: Props) {
  const uid = useId().replace(/:/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const { scan } = view;
  const plotW = Math.max(200, width - PLOT_LEFT - PLOT_RIGHT);
  const spanMs = scan.n * scan.stepMs;
  const xOfMs = (ms: number) => PLOT_LEFT + ((ms - scan.startMs) / spanMs) * plotW;

  const runs = useMemo(() => {
    const out: { k0: number; k1: number; code: number }[] = [];
    for (let k = 0; k < scan.n; k++) {
      const c = scan.code[k];
      const last = out[out.length - 1];
      if (last && last.code === c) last.k1 = k;
      else out.push({ k0: k, k1: k, code: c });
    }
    return out;
  }, [scan]);

  const months = useMemo(() => {
    const out: { ms: number; label: string }[] = [];
    const d0 = new Date(scan.startMs);
    let y = d0.getUTCFullYear(), m = d0.getUTCMonth();
    for (let i = 0; i < 14; i++) {
      const ms = Date.UTC(y, m, 1);
      if (ms > scan.startMs + spanMs) break;
      if (ms >= scan.startMs) out.push({ ms, label: m === 0 || out.length === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m] });
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return out;
  }, [scan.startMs, spanMs]);

  const kOfClient = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * width;
    return Math.min(scan.n - 1, Math.max(0, Math.floor(((px - PLOT_LEFT) / plotW) * scan.n)));
  };
  const msOfK = (k: number) => scan.startMs + k * scan.stepMs;

  const landing = view.landingMs;
  const margin = view.slipMarginMs;
  const lx = xOfMs(landing);
  const cellW = Math.max(1.5, plotW / scan.n);
  const nextStart = view.nextStartMs;
  // End of the next window (last ok cell run).
  let nextEnd: number | null = null;
  if (nextStart !== null) {
    let k = Math.round((nextStart - scan.startMs) / scan.stepMs);
    while (k + 1 < scan.n && scan.code[k + 1] === 0) k++;
    nextEnd = msOfK(k);
  }
  const hoverMs = hover === null ? null : msOfK(hover);

  const move = (dir: number, big: boolean) => {
    const step = (big ? 24 : 6) * HOUR * dir;
    const t = Math.min(msOfK(scan.n - 1), Math.max(scan.startMs, landing + step));
    onPick(t);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-[13px]" style={{ paddingLeft: PLOT_LEFT - 70 }}>
        <span className="font-semibold text-ink">{label}: landing date, next year (UTC)</span>
        <svg width="0" height="0" aria-hidden="true"><CellDefs uid={`${uid}l`} /></svg>
        {showKey && [0, 1, 2, 3, 4].map((c) => (
          <span key={c} className="flex items-center gap-1.5 text-ink2">
            <svg width="22" height="12" aria-hidden="true"><rect width="22" height="12" fill={cellFill(`${uid}l`, c)} stroke="var(--text2)" strokeWidth="0.6" /></svg>
            {codeWord(c)[0].toUpperCase() + codeWord(c).slice(1)}
          </span>
        ))}
        <span className="mono min-h-[1.25rem] text-ink" aria-hidden="true">
          {hoverMs !== null && `${fmtDateTimeUtc(hoverMs)}: ${codeWord(scan.code[hover!])}`}
        </span>
      </div>
      <svg
        ref={ref}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="slider"
        tabIndex={0}
        aria-label={`${label} landing date, within the next year`}
        aria-valuemin={scan.startMs}
        aria-valuemax={msOfK(scan.n - 1)}
        aria-valuenow={landing}
        aria-valuetext={`${fmtDateTimeUtc(landing)}. ${view.ev.ok ? 'Works' : 'Fails'}. Left and right arrows move 6 hours, shift moves one day.`}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') move(1, e.shiftKey);
          else if (e.key === 'ArrowLeft') move(-1, e.shiftKey);
          else if (e.key === 'PageUp') move(1, true);
          else if (e.key === 'PageDown') move(-1, true);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          onPick(msOfK(kOfClient(e.clientX)));
        }}
        onPointerMove={(e) => {
          const k = kOfClient(e.clientX);
          setHover(k);
          if (e.buttons & 1) onPick(msOfK(k));
        }}
        onPointerLeave={() => setHover(null)}
        className="block cursor-pointer select-none touch-none"
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        <CellDefs uid={uid} />
        <rect x={PLOT_LEFT} y={LANE_Y} width={plotW} height={LANE_H} fill="var(--sky)" stroke="var(--line)" />
        {runs.map((r, i) => (
          <rect
            key={i}
            x={PLOT_LEFT + (r.k0 / scan.n) * plotW}
            y={LANE_Y}
            width={Math.max(cellW, ((r.k1 - r.k0 + 1) / scan.n) * plotW)}
            height={LANE_H}
            fill={cellFill(uid, r.code)}
          />
        ))}
        <text x={PLOT_LEFT - 8} y={LANE_Y + 15} textAnchor="end" fontSize="12" fill="var(--text)">{label}</text>

        {/* Next window (bracket under the lane) */}
        {nextStart !== null && nextStart !== landing && (
          <g>
            <path
              d={`M${xOfMs(nextStart)},${LANE_Y + LANE_H + 14} V${LANE_Y + LANE_H + 20} H${Math.max(xOfMs(nextStart) + 3, xOfMs(nextEnd! + scan.stepMs))} V${LANE_Y + LANE_H + 14}`}
              fill="none" stroke="var(--text)" strokeWidth="1.5"
            />
            <text
              x={Math.min(xOfMs(nextStart), PLOT_LEFT + plotW - 250)}
              y={LANE_Y + LANE_H + 35}
              fontSize="11.5" fill="var(--text)" className="mono"
            >
              next window: {fmtDateShortUtc(nextStart)}, {fmtDuration((nextStart - landing) / HOUR)} later
            </text>
          </g>
        )}
        {nextStart === null && !view.ev.ok && (
          <text x={PLOT_LEFT} y={LANE_Y + LANE_H + 35} fontSize="11.5" fill="var(--text2)">No landing date in this year works.</text>
        )}

        {/* Slip margin: bracket from the chosen date to the last working date */}
        {view.ev.ok && (
          <g>
            <path
              d={`M${lx},${LANE_Y + LANE_H + 3} V${LANE_Y + LANE_H + 9} H${Math.max(lx + 3, xOfMs(landing + margin + scan.stepMs))} V${LANE_Y + LANE_H + 3}`}
              fill="none" stroke="var(--good)" strokeWidth="2"
            />
            <text x={Math.max(lx + 3, xOfMs(landing + margin + scan.stepMs)) + 6} y={LANE_Y + LANE_H + 11} fontSize="11.5" fill="var(--text)" className="mono">
              slip margin {margin > 0 ? fmtDuration(margin / HOUR) : '0 hours'}
            </text>
          </g>
        )}

        {/* Months */}
        {months.map((m) => (
          <g key={m.ms}>
            <line x1={xOfMs(m.ms)} x2={xOfMs(m.ms)} y1={LANE_Y + LANE_H} y2={LANE_Y + LANE_H + 3} stroke="var(--text2)" />
            <text x={xOfMs(m.ms) + 2} y={HEIGHT - 4} fontSize="11" fill="var(--text2)" className="mono">{m.label}</text>
          </g>
        ))}
        <text x={PLOT_LEFT} y={HEIGHT - 17} fontSize="0" />

        {/* Chosen date */}
        <line x1={lx} x2={lx} y1={14} y2={LANE_Y + LANE_H + 2} stroke="var(--text)" strokeWidth="2" />
        <path d={`M${lx - 5},8 L${lx + 5},8 L${lx},15 Z`} fill="var(--text)" />
        <text
          x={lx + (lx > PLOT_LEFT + plotW - 220 ? -8 : 8)}
          y={13}
          textAnchor={lx > PLOT_LEFT + plotW - 220 ? 'end' : 'start'}
          fontSize="11.5" fill="var(--text)" className="mono halo"
        >
          {fmtDateTimeUtc(landing)}
        </text>
        {hover !== null && (
          <line x1={PLOT_LEFT + ((hover + 0.5) / scan.n) * plotW} x2={PLOT_LEFT + ((hover + 0.5) / scan.n) * plotW} y1={LANE_Y} y2={LANE_Y + LANE_H} stroke="var(--text)" strokeWidth="1" opacity="0.8" />
        )}
      </svg>
    </div>
  );
}
