// Side-by-side comparison of the two plans: both landing-date strips, and one table of key numbers.

import { useRef } from 'react';
import { fmtDuration, fmtNum, fmtPct } from '../engine/verdict';
import type { PlanState } from '../state/hooks';
import { LandingStrip } from './LandingStrip';
import { useWidth } from './hooks';

type Ready = Extract<PlanState, { status: 'ready' }>;

export function LandingDates({ planA, planB, onPickA, onPickB }: { planA: PlanState; planB: PlanState; onPickA(ms: number): void; onPickB(ms: number): void }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  return (
    <section aria-labelledby="landing-h" className="rounded-lg border border-line bg-panel px-4 py-3">
      <h2 id="landing-h" className="text-base font-semibold">
        Landing dates
      </h2>
      <p className="mb-2 text-xs text-ink2">
        One cell per 6 hours of landing time for the next year. Click or drag a strip to move that plan&apos;s landing date.
      </p>
      <div ref={box} className="space-y-3">
        {planA.status === 'ready' ? (
          <LandingStrip width={width} view={planA.view} onPick={onPickA} label="Plan A" showKey />
        ) : (
          <p className="text-sm text-ink2">Plan A landing dates are being computed...</p>
        )}
        {planB.status === 'ready' ? (
          <LandingStrip width={width} view={planB.view} onPick={onPickB} label="Plan B" showKey={false} />
        ) : (
          <p className="text-sm text-ink2">Plan B landing dates are being computed...</p>
        )}
      </div>
    </section>
  );
}

interface Cell {
  value: string;
  sub?: string;
}

function cells(pl: Ready) {
  const { view } = pl;
  const { ev, profile } = view;
  const earthRise = pl.data.geom.earthRise;
  const set = (h: number | null, none: string, atLanding: string) => (h === null ? none : h <= 0 ? atLanding : fmtDuration(h));
  const sunset: Cell = {
    value: set(ev.firstSunsetAfterH, 'none in stay', 'down at landing'),
    sub: ev.firstSunsetAfterH === null ? 'Sun stays up' : 'after landing',
  };
  const earthset: Cell =
    earthRise === 'never'
      ? { value: 'Earth never rises', sub: 'far-side geometry' }
      : {
          value: set(ev.firstEarthsetAfterH, 'none in stay', 'down at landing'),
          sub: ev.firstEarthsetAfterH === null ? 'Earth stays in view' : 'after landing',
        };
  const sun: Cell = { value: fmtPct(ev.sunShare), sub: `of the ${fmtNum(profile.stayDays, 1)}-day stay` };
  const earth: Cell = { value: fmtPct(ev.earthShare), sub: `of the stay; ${fmtPct(profile.minEarthShare)} needed` };
  const dark: Cell = {
    value: ev.longestDarkGapH > 0 ? fmtDuration(ev.longestDarkGapH) : 'none',
    sub: profile.maxDarkGapHours > 0 ? `up to ${fmtDuration(profile.maxDarkGapHours)} allowed` : 'none allowed',
  };
  const slip: Cell = {
    value: ev.ok ? (view.slipMarginMs > 0 ? fmtDuration(view.slipMarginMs / 3600000) : '0 hours') : 'none: fails',
    sub: 'delay that still works',
  };
  return [sunset, earthset, sun, earth, dark, slip];
}

const ROWS = ['Time to sunset', 'Time to Earthset', 'Sun share', 'Earth share', 'Longest dark spell in the stay', 'Slip margin'];

export function KeyNumbers({ planA, planB }: { planA: PlanState; planB: PlanState }) {
  const a = planA.status === 'ready' ? cells(planA) : null;
  const b = planB.status === 'ready' ? cells(planB) : null;
  const cell = (c: Cell | undefined) =>
    c ? (
      <>
        <div className="mono text-[15px] leading-tight text-ink">{c.value}</div>
        {c.sub && <div className="text-xs text-ink2">{c.sub}</div>}
      </>
    ) : (
      <span className="text-ink2">...</span>
    );
  return (
    <section aria-labelledby="keynum-h" className="rounded-lg border border-line bg-panel px-4 py-3">
      <h2 id="keynum-h" className="mb-2 text-base font-semibold">
        Key numbers
      </h2>
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-xs text-ink2">
            <th scope="col" className="w-[22%] py-1.5 pr-3 font-semibold">Measure</th>
            <th scope="col" className="w-[39%] py-1.5 pr-3 font-semibold">Plan A</th>
            <th scope="col" className="w-[39%] py-1.5 font-semibold">Plan B</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r, i) => (
            <tr key={r} className="border-b border-line/60 last:border-0 align-top">
              <th scope="row" className="py-1.5 pr-3 text-[13px] font-normal text-ink">
                {r}
              </th>
              <td className="py-1.5 pr-3">{cell(a?.[i])}</td>
              <td className="py-1.5">{cell(b?.[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
