// Mission strip: the stay as a timeline with one bar for the Sun, one for Earth, and the time cursor.
// Scrubbing, play and pause happen here. Aligned with the ribbon above it.

import { useId, useMemo, useRef, type ReactNode } from 'react';
import { intervalsAbove } from '../engine/visibility';
import { fmtDateTimeUtc, fmtDuration, fmtNum } from '../engine/verdict';
import type { PlanData } from '../state/hooks';
import type { PlanView } from '../state/plan';
import type { Cursor } from './hooks';
import { PLOT_LEFT, PLOT_RIGHT } from './Ribbon';

const HEIGHT = 64;
const HOUR = 3600000;

interface Props {
  width: number;
  data: PlanData;
  view: PlanView;
  cursor: Cursor;
  label: string;
  /** Shown at the right end of the control row instead of the key (the ribbon's pointer readout). */
  aside?: ReactNode;
}

function niceStep(stayDays: number, plotW: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 20, 25, 50]) if (stayDays / s <= plotW / 70) return s;
  return 50;
}

export function MissionStrip({ width, data, view, cursor, label, aside }: Props) {
  const uid = useId().replace(/:/g, '');
  const { series } = data;
  const plotW = Math.max(200, width - PLOT_LEFT - PLOT_RIGHT);
  const stayH = view.profile.stayDays * 24;
  const x = (h: number) => PLOT_LEFT + (h / stayH) * plotW;
  const ref = useRef<SVGSVGElement>(null);

  const L = view.landingIdx;
  const end = view.stayEndIdx;
  const runs = useMemo(() => {
    const sun = intervalsAbove(series.sunFrac.subarray(L, end), view.landingMs, series.stepMs);
    const earth = intervalsAbove(series.earthFrac.subarray(L, end), view.landingMs, series.stepMs);
    // A run that reaches the last sample of the stay is drawn to the end of the stay.
    const toH = (r: { startMs: number; endMs: number }) => {
      const h1 = (r.endMs - view.landingMs) / HOUR;
      return { h0: (r.startMs - view.landingMs) / HOUR, h1: h1 >= stayH - 1.01 ? stayH : h1 };
    };
    return { sun: sun.map(toH), earth: earth.map(toH) };
  }, [series, L, end, view.landingMs, stayH]);

  const step = niceStep(view.profile.stayDays, plotW);
  const ticks: number[] = [];
  for (let d = 0; d <= view.profile.stayDays + 1e-9; d += step) ticks.push(d);

  const setFromPointer = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * width;
    cursor.setHours(((px - PLOT_LEFT) / plotW) * stayH);
  };

  const idx = Math.min(series.n - 1, L + cursor.hours);
  const sunUp = series.sunFrac[idx] >= 0.5;
  const earthUp = series.earthFrac[idx] >= 0.5;
  const nowMs = view.landingMs + cursor.hours * HOUR;
  const fail = view.ev.firstFailureAfterH;

  const onKey = (e: React.KeyboardEvent) => {
    const big = e.shiftKey ? 24 : 1;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        cursor.setHours(cursor.hours + big);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        cursor.setHours(cursor.hours - big);
        break;
      case 'PageUp':
        cursor.setHours(cursor.hours + 24);
        break;
      case 'PageDown':
        cursor.setHours(cursor.hours - 24);
        break;
      case 'Home':
        cursor.setHours(0);
        break;
      case 'End':
        cursor.setHours(stayH);
        break;
      case ' ':
      case 'Enter':
        cursor.toggle();
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-1" style={{ paddingLeft: PLOT_LEFT - 70, paddingRight: PLOT_RIGHT }}>
        <button
          type="button"
          onClick={cursor.toggle}
          aria-pressed={cursor.playing}
          className="flex min-w-[86px] items-center justify-center gap-2 rounded-md border border-[#454b57] bg-sky px-3 py-0.5 text-sm hover:border-ink2"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            {cursor.playing ? (
              <path d="M2,1 H5 V11 H2 Z M7,1 H10 V11 H7 Z" fill="currentColor" />
            ) : (
              <path d="M2,1 L11,6 L2,11 Z" fill="currentColor" />
            )}
          </svg>
          {cursor.playing ? 'Pause' : 'Play'}
        </button>
        <span className="mono text-[13px]" aria-live="off">
          {fmtNum(cursor.hours / 24, 1)} days after landing | {fmtDateTimeUtc(nowMs)}
        </span>
        <span className="text-[13px] text-ink2">
          Sun {sunUp ? 'up' : 'hidden'}; Earth {earthUp ? 'in view' : 'hidden'}
        </span>
        {fail !== null && (
          <span className="text-[13px] text-ink2">
            First requirement broken {fail <= 0 ? 'at landing' : `${fmtDuration(fail)} after landing`}
          </span>
        )}
        <span className="mono ml-auto flex flex-wrap items-center gap-x-3 text-xs text-ink2">
          {aside ?? <span className="font-sans">Filled: up. Hatched: Sun hidden. Empty: Earth hidden.</span>}
        </span>
      </div>
      <svg
        ref={ref}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        role="slider"
        tabIndex={0}
        aria-label={`${label} time cursor, hours after landing`}
        aria-valuemin={0}
        aria-valuemax={stayH}
        aria-valuenow={cursor.hours}
        aria-valuetext={`${fmtNum(cursor.hours / 24, 1)} days after landing, ${fmtDateTimeUtc(nowMs)}. Sun ${sunUp ? 'up' : 'hidden'}, Earth ${earthUp ? 'in view' : 'hidden'}`}
        onKeyDown={onKey}
        onPointerDown={(e) => {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          cursor.pause();
          setFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) setFromPointer(e.clientX);
        }}
        className="block cursor-ew-resize select-none touch-none"
        style={{ fontFamily: 'var(--font-sans)' }}
      >
        <defs>
          <pattern id={`${uid}h`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="var(--dark)" />
            <line x1="0" y1="0" x2="0" y2="7" stroke="var(--text2)" strokeWidth="1.4" opacity="0.7" />
          </pattern>
        </defs>
        {/* Sun bar */}
        <text x={PLOT_LEFT - 8} y={19} textAnchor="end" fontSize="12" fill="var(--text)">Sun</text>
        <rect x={PLOT_LEFT} y={6} width={plotW} height={16} fill={`url(#${uid}h)`} stroke="var(--line)" />
        {runs.sun.map((r, i) => (
          <rect key={i} x={x(r.h0)} y={6} width={Math.max(1, x(r.h1) - x(r.h0))} height={16} fill="var(--sun)" />
        ))}
        {/* Earth bar */}
        <text x={PLOT_LEFT - 8} y={39} textAnchor="end" fontSize="12" fill="var(--text)">Earth</text>
        <rect x={PLOT_LEFT} y={26} width={plotW} height={16} fill="var(--sky)" stroke="var(--line)" />
        {runs.earth.map((r, i) => (
          <rect key={i} x={x(r.h0)} y={26} width={Math.max(1, x(r.h1) - x(r.h0))} height={16} fill="var(--earth)" />
        ))}
        {/* Axis */}
        {ticks.map((d) => (
          <g key={d}>
            <line x1={x(d * 24)} x2={x(d * 24)} y1={42} y2={46} stroke="var(--text2)" />
            <text x={x(d * 24)} y={58} textAnchor="middle" fontSize="11" fill="var(--text2)" className="mono">{fmtNum(d, 1)}</text>
          </g>
        ))}
        <text x={PLOT_LEFT - 8} y={58} textAnchor="end" fontSize="11" fill="var(--text2)">Days</text>
        {/* First failure */}
        {fail !== null && fail >= 0 && fail <= stayH && (
          <g>
            <line x1={x(fail)} x2={x(fail)} y1={3} y2={46} stroke="var(--alert)" strokeWidth="1.5" strokeDasharray="3 2" />
            <path d={`M${x(fail) - 5},3 L${x(fail) + 5},3 L${x(fail)},10 Z`} fill="var(--alert)" />
            <text x={x(fail) + (x(fail) > PLOT_LEFT + plotW - 120 ? -8 : 8)} y={9} textAnchor={x(fail) > PLOT_LEFT + plotW - 120 ? 'end' : 'start'} fontSize="11" fill="var(--alert)" className="halo">
              first failure
            </text>
          </g>
        )}
        {/* Cursor */}
        <line x1={x(cursor.hours)} x2={x(cursor.hours)} y1={2} y2={46} stroke="var(--text)" strokeWidth="2" />
        <rect x={x(cursor.hours) - 5} y={0} width={10} height={6} rx="1.5" fill="var(--text)" />
      </svg>
    </div>
  );
}
