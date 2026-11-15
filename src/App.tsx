// Ribbon: a lunar landing-site navigator. At the Moon's south pole, the skyline is the calendar.
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { compareSentence } from './engine/verdict';
import { DEFAULT_RANGE, fitRange } from './state/plan';
import { effectiveAnchor, useCatalog, usePlan, useScenario } from './state/hooks';
import { DEFAULT_SITE, effectiveProfile, landingBMs } from './state/scenario';
import { customId, customSite, parseCustomId } from './state/custom';
import { Controls } from './ui/Controls';
import { KeyNumbers, LandingDates } from './ui/Compare';
import { HowToRead } from './ui/HowToRead';
import { Legend } from './ui/Legend';
import { Credits, Validation } from './ui/Sections';
import { PlanPanel } from './ui/PlanPanel';
import { SitesCalendar } from './ui/SitesCalendar';
import { RegionMap } from './ui/RegionMap';
const Terrain3D = lazy(() => import('./ui/Terrain3D'));
import { exportCsv, exportReport } from './ui/Export';
import { Tour } from './ui/Tour';
import { Replays } from './ui/Replays';
import { useCursor, usePlotHeight } from './ui/hooks';

export default function App() {
  const api = useScenario();
  const { s, anchors } = api;
  const cat = useCatalog();
  const [hoverAz, setHoverAz] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [trueScale, setTrueScale] = useState(false);
  const [show3d, setShow3d] = useState(false);
  const [tour, setTour] = useState(false);

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
          <button type="button" onClick={() => setTour(true)} className="text-ink underline decoration-sun underline-offset-4 hover:decoration-ink">Take the tour</button>
          {[['how-to-read', 'How to read this'], ['validation', 'Validation'], ['credits', 'Data and credits']].map(([id, t]) => (
            <button type="button" key={id} onClick={() => document.getElementById(id)?.scrollIntoView()} className="text-ink underline decoration-ink2 underline-offset-4 hover:decoration-ink">
              {t}
            </button>
          ))}
        </nav>
      </header>
      <Tour open={tour} onClose={() => setTour(false)} />

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
          <section id="comparison" aria-label="Comparison" className="pb-1 pt-0.5">
            <h2 className="visually-hidden">Plan A against plan B</h2>
            <p className="max-w-[110ch] text-[20px] font-medium leading-[1.3] text-ink" aria-live="polite">
              {comparison ?? 'Comparing the two plans once both are computed...'}
            </p>
          </section>

          <Controls api={api} />
          <Replays api={api} />
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink2" role="group" aria-label="Vertical scale of the ribbons">
            <span>Vertical scale:</span>
            {([[false, 'Stretched, so low hills show'], [true, 'True proportion']] as const).map(([v, t]) => (
              <button
                key={t} type="button" aria-pressed={trueScale === v} onClick={() => setTrueScale(v)}
                className={`rounded-md border px-2.5 py-1 ${trueScale === v ? 'border-ink2 bg-panel text-ink' : 'border-line text-ink2 hover:border-ink2'}`}
              >
                {t}
              </button>
            ))}
          </div>

          <PlanPanel
            label="Plan A" sites={sites} siteId={s.siteA} onSite={api.setSiteA} plan={planA} heightM={s.heightM} range={range}
            hoverAz={hoverAz} onHover={setHoverAz} cursor={cursor} plotH={plotH} trueScale={trueScale} onRetry={() => setRetry((r) => r + 1)}
          />
          <PlanPanel
            label="Plan B" sites={sites} siteId={s.siteB} onSite={api.setSiteB} plan={planB} heightM={s.heightM} range={range}
            hoverAz={hoverAz} onHover={setHoverAz} cursor={cursor} plotH={plotH} trueScale={trueScale} onRetry={() => setRetry((r) => r + 1)}
          />
          <LandingDates planA={planA} planB={planB} onPickA={(ms) => api.setLandingA(ms, true)} onPickB={(ms) => api.setLandingB(ms, true)} />
          <KeyNumbers planA={planA} planB={planB} />
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink2">
            <span>Save this comparison:</span>
            <button type="button" disabled={planA.status !== 'ready' || planB.status !== 'ready'} onClick={() => exportReport(comparison, planA, planB, s.heightM, profile.label)} className="rounded-md border border-line px-2.5 py-1 hover:border-ink2 disabled:opacity-50">Report (HTML)</button>
            <button type="button" disabled={planA.status !== 'ready' || planB.status !== 'ready'} onClick={() => exportCsv(planA, planB, s.heightM)} className="rounded-md border border-line px-2.5 py-1 hover:border-ink2 disabled:opacity-50">Hourly data (CSV)</button>
          </div>
          <section id="site-3d" aria-labelledby="t3d-h" className="rounded-lg border border-line bg-panel px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="t3d-h" className="text-base font-semibold">Plan A&apos;s site in 3D</h2>
              <button type="button" onClick={() => setShow3d((v) => !v)} className="rounded-md border border-[#454b57] px-3 py-1 text-sm hover:border-ink2">
                {show3d ? 'Hide the 3D view' : 'Show the 3D view'}
              </button>
            </div>
            {show3d && planA.status === 'ready' && (() => {
              const i = Math.min(planA.data.series.n - 1, planA.view.landingIdx + cursor.hours);
              const ser = planA.data.series;
              const site = planA.data.site;
              return (
                <Suspense fallback={<p className="mt-2 text-sm text-ink2">Loading the 3D view...</p>}>
                  <div className="mt-2">
                    <Terrain3D
                      lat={site.lat} lon={site.lon} heightM={s.heightM}
                      sunAz={ser.sunAz[i]} sunEl={ser.sunEl[i]} earthAz={ser.earthAz[i]} earthEl={ser.earthEl[i]}
                      caption={`${site.name}, ${new Date(ser.startMs + i * ser.stepMs).toISOString().slice(0, 16).replace('T', ' ')} UTC (plan A's time cursor; press Play above to move it).`}
                    />
                  </div>
                </Suspense>
              );
            })()}
          </section>
          <RegionMap
            site={siteA} heightM={s.heightM} landingMs={s.landingMs} stayDays={profile.stayDays}
            onPickB={(lat, lon) => { api.setSiteB(customId(lat, lon)); document.getElementById('plan-b')?.scrollIntoView({ behavior: 'smooth' }); }}
          />
          <SitesCalendar
            sites={sites} heightM={s.heightM} anchorMs={effectiveAnchor(anchors.a, s.landingMs)} profile={profile}
            onPick={(id, ms) => { api.setSiteB(id); api.setBMode('own'); api.setBOwn(ms); document.getElementById('plan-b')?.scrollIntoView({ behavior: 'smooth' }); }}
          />
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
