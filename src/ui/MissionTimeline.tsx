// Mission timeline (version 2): power, battery and Deep Space Network contact through the stay,
// aligned with the mission strip above it. Panel and battery are this tool's default assumptions
// (engine/power.ts); contact needs Earth in view from the lander and the Moon at least 6 degrees
// up at a DSN complex (engine/dsn.ts).

import { useMemo, useRef, useState } from 'react';
import { DSN_COMPLEXES, DSN_RECEIVE_MIN_EL_DEG } from '../engine/dsn';
import { DEFAULT_POWER, simulatePower } from '../engine/power';
import { fmtDateTimeUtc, fmtDuration } from '../engine/verdict';
import type { PlanData } from '../state/hooks';
import type { PlanView } from '../state/plan';
import { PLOT_LEFT, PLOT_RIGHT } from './Ribbon';

const HOUR = 3600000;
const POWER_H = 56, BATT_H = 40, ROW_H = 9, GAP = 10;

interface Props {
  width: number;
  data: PlanData;
  view: PlanView;
  /** Hours after landing of the time cursor. */
  cursorHours: number;
}

export function MissionTimeline({ width, data, view, cursorHours }: Props) {
  const { series, dsn } = data;
  const plotW = Math.max(200, width - PLOT_LEFT - PLOT_RIGHT);
  const L = view.landingIdx;
  const n = Math.max(1, view.stayEndIdx - L);
  const x = (h: number) => PLOT_LEFT + (h / n) * plotW;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const run = useMemo(() => simulatePower(series, DEFAULT_POWER, L, n), [series, L, n]);
  const maxW = Math.max(DEFAULT_POWER.loadW * 1.5, ...Array.from(run.powerW)) * 1.08;
  const floor = view.profile.minBatteryCharge;

  const y0 = 18;
  const pY = (w: number) => y0 + POWER_H - (w / maxW) * POWER_H;
  const bTop = y0 + POWER_H + GAP;
  const bY = (f: number) => bTop + BATT_H - f * BATT_H;
  const rTop = bTop + BATT_H + GAP;
  const H = rTop + DSN_COMPLEXES.length * (ROW_H + 3) + 18;

  const powerPath = useMemo(() => 'M' + Array.from(run.powerW, (w, k) => `${x(k).toFixed(1)},${pY(w).toFixed(1)}`).join('L'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, plotW, maxW]);
  const battPath = useMemo(() => 'M' + Array.from(run.chargeWh, (q, k) => `${x(k).toFixed(1)},${bY(q / DEFAULT_POWER.batteryWh).toFixed(1)}`).join('L'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, plotW]);

  // Per complex, runs of hours in contact (Earth in view and the Moon above the limit there) or only in view of the dish.
  const rows = useMemo(() => DSN_COMPLEXES.map((c, ci) => {
    const contact: [number, number][] = [], dish: [number, number][] = [];
    let a: number | null = null, b: number | null = null;
    for (let k = 0; k <= n; k++) {
      const i = L + k;
      const up = k < n && dsn.moonElDeg[ci][i] >= DSN_RECEIVE_MIN_EL_DEG;
      const link = up && series.earthFrac[i] >= 0.5;
      if (link && a === null) a = k; if (!link && a !== null) { contact.push([a, k]); a = null; }
      if (up && !link && b === null) b = k; if ((!up || link) && b !== null) { dish.push([b, k]); b = null; }
    }
    return { name: c.name.split(',')[0], contact, dish };
  }), [dsn, series, L, n]);

  const eclipses = useMemo(() => {
    const out: number[] = [];
    if (!series.sunCover) return out;
    for (let k = 0; k < n; k++) if (series.sunCover[L + k] > 0.02 && (k === 0 || series.sunCover[L + k - 1] <= 0.02)) out.push(k);
    return out;
  }, [series, L, n]);

  const ticks: number[] = [];
  const stepD = n / 24 <= 8 ? 1 : n / 24 <= 30 ? 5 : 10;
  for (let d = 0; d * 24 <= n; d += stepD) ticks.push(d);

  const onMove = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const k = Math.round(((e.clientX - r.left - PLOT_LEFT) / plotW) * n);
    setHover(k >= 0 && k < n ? k : null);
  };

  const readout = hover === null ? null : (() => {
    const i = L + hover;
    const dishes = DSN_COMPLEXES.filter((_, ci) => dsn.moonElDeg[ci][i] >= DSN_RECEIVE_MIN_EL_DEG).map((c) => c.name.split(',')[0]);
    const link = series.earthFrac[i] >= 0.5 && dishes.length > 0;
    return `${fmtDateTimeUtc(series.startMs + i * series.stepMs)} · ${Math.round(series.sunFrac[i] * 100)}% of the Sun visible · panel ${Math.round(run.powerW[hover])} W · battery ${Math.round((run.chargeWh[hover] / DEFAULT_POWER.batteryWh) * 100)}% · ${link ? `contact via ${dishes.join(', ')}` : series.earthFrac[i] < 0.5 ? 'no contact: Earth hidden' : 'no contact: no DSN dish can see the Moon'}`;
  })();

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13px]" style={{ paddingLeft: PLOT_LEFT - 70 }}>
        <span className="font-semibold text-ink">Power and contact through the stay</span>
        <span className="text-ink2">Panel {DEFAULT_POWER.areaM2} m², {Math.round(DEFAULT_POWER.efficiency * 100)}% efficient, turned to the Sun; battery {DEFAULT_POWER.batteryWh.toLocaleString('en-GB')} Wh; load {DEFAULT_POWER.loadW} W (this tool&apos;s assumptions)</span>
      </div>
      <p className="mono min-h-[1.25rem] text-xs text-ink" style={{ paddingLeft: PLOT_LEFT - 70 }} aria-live="polite">{readout ?? ' '}</p>
      <svg ref={ref} width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block select-none" role="img"
        aria-label={`Panel output, battery charge and Deep Space Network contact over the ${fmtDuration(n)} stay`}
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {/* Power */}
        <text x={PLOT_LEFT - 8} y={y0 + 10} textAnchor="end" fontSize="11" fill="var(--text2)">Panel, W</text>
        {[0, Math.round(maxW / 2 / 50) * 50].map((w) => (
          <g key={`pw${w}`}>
            <line x1={PLOT_LEFT} x2={PLOT_LEFT + plotW} y1={pY(w)} y2={pY(w)} stroke="var(--line)" strokeWidth="0.8" />
            <text x={PLOT_LEFT - 8} y={pY(w) + 4} textAnchor="end" fontSize="10.5" fill="var(--text2)" className="mono">{w}</text>
          </g>
        ))}
        <line x1={PLOT_LEFT} x2={PLOT_LEFT + plotW} y1={pY(DEFAULT_POWER.loadW)} y2={pY(DEFAULT_POWER.loadW)} stroke="var(--text2)" strokeDasharray="4 3" />
        <text x={PLOT_LEFT + plotW} y={pY(DEFAULT_POWER.loadW) - 4} textAnchor="end" fontSize="10.5" fill="var(--text2)">load {DEFAULT_POWER.loadW} W</text>
        <path d={powerPath} fill="none" stroke="var(--sun)" strokeWidth="2" strokeLinejoin="round" />
        {eclipses.map((k) => (
          <g key={`ec${k}`}>
            <line x1={x(k)} x2={x(k)} y1={y0} y2={y0 + POWER_H} stroke="var(--text)" strokeDasharray="2 2" />
            <text x={x(k) + 4} y={y0 + 10} fontSize="10.5" fill="var(--text)">eclipse</text>
          </g>
        ))}
        {/* Battery */}
        <text x={PLOT_LEFT - 8} y={bTop + 10} textAnchor="end" fontSize="11" fill="var(--text2)">Battery</text>
        <rect x={PLOT_LEFT} y={bTop} width={plotW} height={BATT_H} fill="none" stroke="var(--line)" />
        {floor !== undefined && (
          <g>
            <line x1={PLOT_LEFT} x2={PLOT_LEFT + plotW} y1={bY(floor)} y2={bY(floor)} stroke="var(--alert)" strokeDasharray="4 3" />
            <text x={PLOT_LEFT + plotW} y={bY(floor) - 3} textAnchor="end" fontSize="10.5" fill="var(--text2)">reserve {Math.round(floor * 100)}%</text>
          </g>
        )}
        <path d={battPath} fill="none" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="round" />
        <text x={PLOT_LEFT - 8} y={bTop + BATT_H} textAnchor="end" fontSize="10.5" fill="var(--text2)" className="mono">0%</text>
        <text x={PLOT_LEFT - 8} y={bTop + 18} textAnchor="end" fontSize="10.5" fill="var(--text2)" className="mono">100%</text>
        {/* DSN complexes */}
        {rows.map((r, ri) => {
          const y = rTop + ri * (ROW_H + 3);
          return (
            <g key={r.name}>
              <text x={PLOT_LEFT - 8} y={y + ROW_H - 1} textAnchor="end" fontSize="10.5" fill="var(--text2)">{r.name}</text>
              <rect x={PLOT_LEFT} y={y} width={plotW} height={ROW_H} fill="var(--sky)" stroke="var(--line)" strokeWidth="0.6" />
              {r.dish.map(([a, b]) => <rect key={`d${a}`} x={x(a)} y={y} width={Math.max(1, x(b) - x(a))} height={ROW_H} fill="var(--earth)" fillOpacity="0.22" />)}
              {r.contact.map(([a, b]) => <rect key={`c${a}`} x={x(a)} y={y} width={Math.max(1, x(b) - x(a))} height={ROW_H} fill="var(--earth)" />)}
            </g>
          );
        })}
        {ticks.map((d) => (
          <text key={`t${d}`} x={x(d * 24)} y={H - 4} textAnchor="middle" fontSize="10.5" fill="var(--text2)" className="mono">{d === 0 ? 'day 0' : d}</text>
        ))}
        {/* Cursor */}
        <line x1={x(Math.min(n, cursorHours))} x2={x(Math.min(n, cursorHours))} y1={y0 - 4} y2={rTop + DSN_COMPLEXES.length * (ROW_H + 3)} stroke="var(--text)" strokeWidth="1" opacity="0.7" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={y0 - 4} y2={rTop + DSN_COMPLEXES.length * (ROW_H + 3)} stroke="var(--text2)" strokeWidth="1" />}
      </svg>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink2" style={{ paddingLeft: PLOT_LEFT - 70 }}>
        <span><svg width="20" height="8" aria-hidden="true" className="mr-1.5 inline"><rect width="20" height="8" fill="var(--earth)" /></svg>Contact: the dish sees the Moon and Earth is in view from the lander</span>
        <span><svg width="20" height="8" aria-hidden="true" className="mr-1.5 inline"><rect width="20" height="8" fill="var(--earth)" fillOpacity="0.22" /></svg>The dish sees the Moon, but Earth is hidden from the lander</span>
        <span>Times are hours after landing ({new Date(series.startMs + L * HOUR).toISOString().slice(0, 16).replace('T', ' ')} UTC)</span>
      </div>
    </div>
  );
}
