// "How to read this": the three shapes in under a minute, beside a real ribbon with numbered callouts.
// The callouts are placed from the plan's own data (highest skyline point, Sun band at north, longest
// dark span), so nothing in the picture is made up.

import { useMemo, useRef } from 'react';
import { horizonAt } from '../engine/horizon';
import { fmtNum } from '../engine/verdict';
import type { PlanState } from '../state/hooks';
import type { YRange } from '../state/plan';
import { Ribbon, RIBBON_HEIGHT, plotX, plotY } from './Ribbon';
import { useWidth } from './hooks';

type Ready = Extract<PlanState, { status: 'ready' }>;

function Badge({ n, x, y }: { n: number; x: number; y: number }) {
  return (
    <span
      aria-hidden="true"
      className="absolute flex h-6 w-6 items-center justify-center rounded-full border-2 border-ink bg-sky text-xs font-bold text-ink"
      style={{ left: x - 12, top: y - 12 }}
    >
      {n}
    </span>
  );
}

export function HowToRead({ plan, heightM, range }: { plan: PlanState; heightM: number; range: YRange }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box, 700);

  const marks = useMemo(() => {
    if (plan.status !== 'ready') return null;
    const { mask, geom } = plan.data;
    const prof = mask.horizonDeg[String(heightM)];
    // 1: highest point of the skyline.
    let hi = 0;
    for (let i = 1; i < prof.length; i++) if (prof[i] > prof[hi]) hi = i;
    const hiAz = hi * mask.azStepDeg;
    // 2: middle of the Sun band at north.
    const lo0 = geom.sunBand.minEl[0], hi0 = geom.sunBand.maxEl[0];
    const sunEl = Number.isNaN(lo0) || Number.isNaN(hi0) ? 0 : (lo0 + hi0) / 2;
    // 3: the longest dark span in the path window, at the Sun's azimuth halfway through it.
    let span = null as null | { az: number };
    const spans = [...plan.view.spans].sort((a, b) => b.days - a.days);
    if (spans.length) {
      const sp = spans[0];
      const mid = Math.round((((sp.startMs + sp.endMs) / 2) - plan.data.series.startMs) / plan.data.series.stepMs);
      span = { az: plan.data.series.sunAz[Math.min(plan.data.series.n - 1, Math.max(0, mid))] };
    }
    return { hiAz, hiEl: horizonAt(prof, mask.azStepDeg, hiAz), sunEl, span };
  }, [plan, heightM]);

  const rate = plan.status === 'ready' ? plan.view.sunRateDegPerDay : null;
  const perDay = rate === null ? 'about 12 degrees' : `about ${fmtNum(Math.abs(rate), 0)} degrees`;

  return (
    <section id="how-to-read" aria-labelledby="how-h" className="rounded-lg border border-line bg-panel p-6">
      <h2 id="how-h" className="text-xl font-semibold">How to read this</h2>
      <p className="mt-1 text-ink2">
        Stand on the Moon at the landing site and turn through a full circle. The ribbon is that view, unrolled into one strip.
        North is in the middle; turning clockwise runs left to right.
      </p>
      <div className="mt-5 grid grid-cols-[minmax(300px,2fr)_3fr] gap-8">
        <ol className="space-y-4 text-[15px] leading-snug">
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink text-xs font-bold">1</span>
            <span>
              <strong>The skyline.</strong> The white line is where the ground meets the sky, taken from NASA laser-altimeter
              measurements of the real terrain. Wherever it climbs, a hill or crater rim blocks the view.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink text-xs font-bold">2</span>
            <span>
              <strong>The Sun&apos;s lane.</strong> Near the Moon&apos;s poles the Sun never climbs high. It slides along the horizon,
              all the way round once a lunar day, {perDay} of direction per day. The amber band is the narrow lane it
              follows; the numbered ticks are days after landing. The Sun travels right to left at the south pole.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-ink text-xs font-bold">3</span>
            <span>
              <strong>Where the skyline cuts the lane, it is dark.</strong> A hatched bracket marks each stretch where terrain hides
              the Sun. Because the Sun moves a steady amount each day, a wider blocked stretch means more days without power.
              The width <em>is</em> the calendar. The blue patch is where Earth wobbles; if terrain covers it, there is no direct radio link.
            </span>
          </li>
        </ol>
        <div ref={box} className="relative min-w-0 overflow-hidden" style={{ height: RIBBON_HEIGHT }}>
          {plan.status === 'ready' && marks ? (
            <>
              <Ribbon
                width={width}
                data={(plan as Ready).data}
                view={(plan as Ready).view}
                heightM={heightM}
                range={range}
                cursorIdx={(plan as Ready).view.landingIdx}
                hoverAz={null}
                onHover={() => {}}
                title="Example ribbon for plan A with three numbered callouts"
              />
              <Badge n={1} x={plotX(width, marks.hiAz)} y={plotY(range, marks.hiEl) + 22} />
              <Badge n={2} x={plotX(width, 0)} y={plotY(range, marks.sunEl) - 26} />
              {marks.span && <Badge n={3} x={plotX(width, marks.span.az)} y={plotY(range, range.min) - 22} />}
            </>
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-line bg-sky text-ink2">
              The example ribbon appears when plan A has been computed.
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 max-w-[90ch] text-[15px] text-ink">
        <strong>To compare:</strong> the two plans are stacked on the same axes. Change a site or slide the landing date and watch
        the amber lane move behind the skyline. Press Play to run the Sun and Earth along the stay.
      </p>
    </section>
  );
}
