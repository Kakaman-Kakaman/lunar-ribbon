// Ribbon: a lunar landing-site navigator. At the Moon's south pole, the skyline is the calendar.
import { useEffect, useMemo, useState } from 'react';
import { compareSentence } from './engine/verdict';
import { DEFAULT_RANGE, fitRange } from './state/plan';
import { effectiveAnchor, useCatalog, usePlan, useScenario } from './state/hooks';
import { DEFAULT_SITE, effectiveProfile, landingBMs } from './state/scenario';
import { customSite, parseCustomId } from './state/custom';
import { Controls } from './ui/Controls';
import { KeyNumbers, LandingDates } from './ui/Compare';
import { HowToRead } from './ui/HowToRead';
import { Legend } from './ui/Legend';
import { Credits, Validation } from './ui/Sections';
import { PlanPanel } from './ui/PlanPanel';
import { Replays } from './ui/Replays';
import { useCursor, usePlotHeight } from './ui/hooks';

export default function App() {
  const api = useScenario();
  const { s, anchors } = api;
  const cat = useCatalog();
  const [hoverAz, setHoverAz] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);

  const profile = useMemo(() => effectiveProfile(s), [s]);
  const cursor = useCursor(Math.round(profile.stayDays * 24));

  const sites = cat.status === 'ready' ? cat.sites : null;
  // A shared link may name a site that does not exist: fall back to the default site.
  useEffect(() => {
    if (!sites) return;
    const known = (id: string) => sites.some((x) => x.id === id) || parseCustomId(id) !== null;
    if (!known(s.siteA)) api.setSiteA(DEFAULT_SITE);
    if (!known(s.siteB)) api.setSiteB(DEFAULT_SITE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, s.siteA, s.siteB]);

  const siteA = useMemo(() => sites?.find((x) => x.id === s.siteA) ?? customSite(s.siteA) ?? undefined, [sites, s.siteA]);
  const siteB = useMemo(() => sites?.find((x) => x.id === s.siteB) ?? customSite(s.siteB) ?? undefined, [sites, s.siteB]);
  const landingB = landingBMs(s);
  const planA = usePlan(siteA, s.heightM, effectiveAnchor(anchors.a, s.landingMs), s.landingMs, profile, retry);
  const planB = usePlan(siteB, s.heightM, effectiveAnchor(anchors.b, landingB), landingB, profile, retry);

  const range = useMemo(() => {
    const items = [planA, planB].flatMap((pl) =>
      pl.status === 'ready' ? [{ geom: pl.data.geom, sunRadiusDeg: pl.view.sunRadiusDeg, earthRadiusDeg: pl.view.earthRadiusDeg }] : [],
    );
    return items.length ? fitRange(items) : DEFAULT_RANGE;
  }, [planA, planB]);

  const comparison =
    planA.status === 'ready' && planB.status === 'ready'
      ? compareSentence(
          { siteName: planA.data.site.name, landingMs: planA.view.landingMs, ev: planA.view.ev, slipMarginMs: planA.view.slipMarginMs, profile, power: planA.view.power },
          { siteName: planB.data.site.name, landingMs: planB.view.landingMs, ev: planB.view.ev, slipMarginMs: planB.view.slipMarginMs, profile, power: planB.view.power },
        )
      : null;

  const plotH = usePlotHeight();

  return (
    <div className="mx-auto max-w-[1680px] px-6 pb-16">
      <header className="flex h-12 items-center justify-between gap-6">
        <div className="flex min-w-0 items-baseline gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Ribbon</h1>
          <p className="truncate text-sm text-ink2">At the Moon&apos;s south pole, the skyline is the calendar.</p>
        </div>
        <nav aria-label="Sections" className="flex shrink-0 gap-5 text-[13px]">
          {[['how-to-read', 'How to read this'], ['validation', 'Validation'], ['credits', 'Data and credits']].map(([id, t]) => (
            <button type="button" key={id} onClick={() => document.getElementById(id)?.scrollIntoView()} className="text-ink underline decoration-ink2 underline-offset-4 hover:decoration-ink">
              {t}
            </button>
          ))}
        </nav>
      </header>

      {cat.status === 'error' ? (
        <div role="alert" className="rounded-lg border border-alert bg-panel p-6">
          <p className="font-semibold">The site list could not be loaded.</p>
          <p className="mt-1 text-sm text-ink2">{cat.message}</p>
          <button type="button" className="mt-3 rounded-md border border-[#454b57] px-3 py-1.5 text-sm hover:border-ink2" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : cat.status === 'loading' || !sites ? (
        <div role="status" className="rounded-lg border border-line bg-panel p-6 text-ink2">
          Loading the site list...
        </div>
      ) : (
        <main className="space-y-2.5">
          <section aria-label="Comparison" className="pb-1 pt-0.5">
            <h2 className="visually-hidden">Plan A against plan B</h2>
            <p className="max-w-[110ch] text-[20px] font-medium leading-[1.3] text-ink" aria-live="polite">
              {comparison ?? 'Comparing the two plans once both are computed...'}
            </p>
          </section>

          <Controls api={api} />
          <Replays api={api} />

          <PlanPanel
            label="Plan A" sites={sites} siteId={s.siteA} onSite={api.setSiteA} plan={planA} heightM={s.heightM} range={range}
            hoverAz={hoverAz} onHover={setHoverAz} cursor={cursor} plotH={plotH} onRetry={() => setRetry((r) => r + 1)}
          />
          <PlanPanel
            label="Plan B" sites={sites} siteId={s.siteB} onSite={api.setSiteB} plan={planB} heightM={s.heightM} range={range}
            hoverAz={hoverAz} onHover={setHoverAz} cursor={cursor} plotH={plotH} onRetry={() => setRetry((r) => r + 1)}
          />
          <LandingDates planA={planA} planB={planB} onPickA={(ms) => api.setLandingA(ms, true)} onPickB={(ms) => api.setLandingB(ms, true)} />
          <KeyNumbers planA={planA} planB={planB} />
          <Legend />
          <HowToRead plan={planA} heightM={s.heightM} range={range} />
          <Validation />
          <Credits />
          <p className="mono pt-2 text-xs text-ink2">
            {planA.status === 'ready' && `Plan A series: ${Math.round(planA.data.ms)} ms ${planA.data.inWorker ? 'in a background worker' : 'on the main thread'}. `}
            {planB.status === 'ready' && `Plan B series: ${Math.round(planB.data.ms)} ms. `}
            Hourly steps, 495 days each.
          </p>
        </main>
      )}
    </div>
  );
}
