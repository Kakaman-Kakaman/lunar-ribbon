// Guided tour (version 2): six short steps that point at the parts of the page in reading order.
// Each step scrolls its part into view and outlines it; nothing on the page changes.

import { useEffect, useState } from 'react';

const STEPS: { target: string; title: string; text: string }[] = [
  { target: 'comparison', title: 'The answer first', text: 'This sentence compares the two landing plans: plan A, and plan B with the same site a few days later (or another site or date). Everything below explains it.' },
  { target: 'plan-a', title: 'The skyline is the calendar', text: 'The strip is the whole horizon around the site, unrolled, with north in the middle. The grey shape is the real terrain from NASA laser altimetry. The amber lane is where the Sun goes; near the pole it slides along the horizon about 12° a day, so the numbered ticks are days after landing. Where a hill rises into the lane, the lander is in the dark for as many days as the hill is wide.' },
  { target: 'plan-a', title: 'Power and contact', text: 'Under the strip, the stay as a timeline: when the Sun and Earth are up, what the solar panel makes against the load, the battery, and when each Deep Space Network dish can hear the lander. Press Play to run the Sun and Earth along the stay.' },
  { target: 'plan-b', title: 'What a delay costs', text: 'Plan B is checked by the same rules. Its verdict says whether it works, what breaks first and when, and the next landing date that works.' },
  { target: 'landing-dates', title: 'Every landing date at once', text: 'One cell for every 6 hours of landing time over the next year. Green works. Click or drag to move a plan to another date and see why it works or fails.' },
  { target: 'site-3d', title: 'Look around', text: 'See the site in 3D under the Sun of the moment, map sunlight around it, draw a rover route, compare every site across the year, or save the comparison as a report.' },
];

export function Tour({ open, onClose }: { open: boolean; onClose(): void }) {
  const [k, setK] = useState(0);
  useEffect(() => { if (open) setK(0); }, [open]);
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(STEPS[k].target);
    el?.classList.add('tour-focus');
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return () => el?.classList.remove('tour-focus');
  }, [open, k]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const s = STEPS[k];
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="tour-title" className="fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-32px))] rounded-lg border border-ink2 bg-panel p-4 shadow-2xl">
      <p className="mono text-xs text-ink2">Step {k + 1} of {STEPS.length}</p>
      <h2 id="tour-title" className="mt-1 text-base font-semibold text-ink">{s.title}</h2>
      <p className="mt-1 text-sm leading-snug text-ink" aria-live="polite">{s.text}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={onClose} className="text-sm text-ink2 underline underline-offset-4 hover:text-ink">Close</button>
        <div className="flex gap-2">
          <button type="button" disabled={k === 0} onClick={() => setK(k - 1)} className="rounded-md border border-line px-3 py-1 text-sm disabled:opacity-40">Back</button>
          {k < STEPS.length - 1
            ? <button type="button" onClick={() => setK(k + 1)} className="rounded-md border border-ink2 px-3 py-1 text-sm text-ink">Next</button>
            : <button type="button" onClick={onClose} className="rounded-md border border-ink2 px-3 py-1 text-sm text-ink">Done</button>}
        </div>
      </div>
    </div>
  );
}
