// One plan: site picker, terrain badge, verdict, ribbon and mission strip.

import { useMemo, useRef, useState } from 'react';
import { fmtDateTimeUtc, fmtNum, terrainBadge } from '../engine/verdict';
import type { PlanState } from '../state/hooks';
import type { YRange } from '../state/plan';
import { groupLabel, type SiteInfo } from '../state/sites';
import { MissionStrip } from './MissionStrip';
import { Ribbon, hoverReadout, ribbonHeight } from './Ribbon';
import { useWidth, type Cursor } from './hooks';

const REAL_ORDER = ['clps', 'south-pole-feature', 'study-site', 'india'];
const OTHER_ORDER = ['clps', 'apollo', 'surveyor', 'luna', 'china', 'japan', 'other'];

/** Option groups for the site picker: real-terrain sites first. */
export function groupSites(sites: SiteInfo[]): { label: string; sites: SiteInfo[] }[] {
  const out: { label: string; sites: SiteInfo[] }[] = [];
  const real = sites.filter((s) => s.terrain !== 'smooth-sphere');
  const none = sites.filter((s) => s.terrain === 'smooth-sphere');
  for (const g of REAL_ORDER) {
    const list = real.filter((s) => s.group === g);
    if (list.length) out.push({ label: `Real terrain: ${groupLabel(g)}`, sites: list });
  }
  const seen = new Set(OTHER_ORDER);
  const groups = [...OTHER_ORDER, ...[...new Set(none.map((s) => s.group))].filter((g) => !seen.has(g))];
  for (const g of groups) {
    const list = none.filter((s) => s.group === g);
    if (list.length) out.push({ label: `No terrain, geometric estimate: ${groupLabel(g)}`, sites: list });
  }
  return out;
}

const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? 'S' : 'N'}`;
const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(3)}° ${lon < 0 ? 'W' : 'E'}`;

interface Props {
  label: 'Plan A' | 'Plan B';
  sites: SiteInfo[];
  siteId: string;
  onSite(id: string): void;
  plan: PlanState;
  heightM: number;
  range: YRange;
  hoverAz: number | null;
  onHover(az: number | null): void;
  cursor: Cursor;
  /** Height of each ribbon's plot area, pixels. */
  plotH: number;
  onRetry(): void;
}

function Skeleton({ plotH }: { plotH: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-md border border-line bg-sky text-ink2"
      style={{ height: ribbonHeight(plotH) + 24 + 94 }}
    >
      <p className="text-sm">Computing where the Sun and Earth sit against the skyline, hour by hour for 495 days...</p>
      <div className="relative h-1.5 w-72 overflow-hidden rounded bg-line">
        <div className="pulse-bar absolute inset-y-0 left-0 w-1/3 rounded bg-earth" />
      </div>
    </div>
  );
}

function VerdictMark({ ok }: { ok: boolean }) {
  return ok ? (
    <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" className="shrink-0">
      <circle cx="17" cy="17" r="15" fill="none" stroke="var(--good)" strokeWidth="3" />
      <path d="M9.5,17.5 L15,23 L25,11.5" fill="none" stroke="var(--good)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="26" height="26" viewBox="0 0 34 34" aria-hidden="true" className="shrink-0">
      <path d="M11,2.5 H23 L31.5,11 V23 L23,31.5 H11 L2.5,23 V11 Z" fill="none" stroke="var(--alert)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M11.5,11.5 L22.5,22.5 M22.5,11.5 L11.5,22.5" stroke="var(--alert)" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}

function VerdictBox({ plan }: { plan: PlanState }) {
  if (plan.status !== 'ready') {
    return (
      <div className="rounded-md border border-line bg-sky p-3 text-ink2">
        {plan.status === 'error' ? 'No verdict: the data did not load.' : 'Working out the verdict...'}
      </div>
    );
  }
  const { verdict } = plan.view;
  return (
    <div
      className={`flex gap-3 rounded-md border bg-sky px-3 py-2 ${plan.stale ? 'opacity-50' : ''}`}
      style={{ borderColor: verdict.ok ? 'var(--good)' : 'var(--alert)' }}
    >
      <div className="shrink-0 pt-0.5">
        <VerdictMark ok={verdict.ok} />
      </div>
      <div className="min-w-0 text-[13.5px] leading-snug text-ink">
        <p>
          {verdict.sentences.join(' ').startsWith(verdict.word) ? (
            <>
              <strong className="text-[15px] font-semibold">{verdict.word}</strong>
              {verdict.sentences.join(' ').slice(verdict.word.length)}
            </>
          ) : (
            <>
              <strong className="text-[15px] font-semibold">{verdict.word}.</strong> {verdict.sentences.join(' ')}
            </>
          )}
        </p>
        {plan.data.geom.earthRise === 'never' && (
          <p className="mt-1">
            Earth never rises at this site in the period shown (it stays below the horizon, as on the far side of the Moon), so there is
            no direct-to-Earth link on any landing date.
          </p>
        )}
        {plan.data.geom.earthRise === 'hidden' && (
          <p className="mt-1">Earth rises above the horizon here but terrain always hides at least half of it, so there is no direct-to-Earth link.</p>
        )}
      </div>
    </div>
  );
}

export function PlanPanel(p: Props) {
  const inner = useRef<HTMLDivElement>(null);
  const width = useWidth(inner);
  const groups = useMemo(() => groupSites(p.sites), [p.sites]);
  const [notesOpen, setNotesOpen] = useState(false);
  const { plan } = p;
  const site = p.sites.find((s) => s.id === p.siteId);
  const accent = p.label === 'Plan A' ? 'A' : 'B';

  return (
    <section aria-label={p.label} className="rounded-lg border border-line bg-panel px-4 py-2.5">
      <div className="flex flex-wrap items-start gap-x-5 gap-y-2">
        {/* Site */}
        <div className="w-[34rem] max-w-full shrink-0">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-ink2 text-sm font-semibold text-ink">
              {accent}
            </span>
            <label htmlFor={`site-${accent}`} className="visually-hidden">
              {p.label} site
            </label>
            <select id={`site-${accent}`} value={p.siteId} onChange={(e) => p.onSite(e.target.value)} className="h-8 min-w-0 max-w-[26rem] flex-1 !py-0">
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {plan.status === 'ready' && <span className="mono shrink-0 text-xs text-ink2">lands {fmtDateTimeUtc(plan.view.landingMs)}</span>}
          </div>
          {site && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink2">
              <span className="mono">
                {fmtLat(site.lat)}, {fmtLon(site.lon)}
                {site.groundElevM !== null && <> | ground {fmtNum(site.groundElevM, 1)} m</>}
              </span>
              <span className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-px text-xs text-ink ${site.terrain === 'smooth-sphere' ? 'border-ink2' : 'border-line'}`}>
                <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
                  {site.terrain === 'smooth-sphere' ? (
                    <path d="M0,5 H14" stroke="var(--text2)" strokeWidth="1.5" strokeDasharray="3 2" />
                  ) : (
                    <path d="M0,8 L3,4 L5,6 L8,1 L11,5 L14,3" fill="none" stroke="var(--terrain-edge)" strokeWidth="1.4" />
                  )}
                </svg>
                {terrainBadge(site.terrain)}
              </span>
              {site.note && (
                <button
                  type="button"
                  aria-expanded={notesOpen}
                  aria-controls={`notes-${accent}`}
                  onClick={() => setNotesOpen((o) => !o)}
                  className="text-ink underline decoration-ink2 underline-offset-2 hover:decoration-ink"
                >
                  {notesOpen ? '▾' : '▸'} Site notes
                </button>
              )}
            </div>
          )}
        </div>

        {/* Verdict */}
        <div className="min-w-[22rem] flex-1" aria-live="polite">
          <VerdictBox plan={plan} />
        </div>
      </div>
      {notesOpen && site?.note && (
        <p id={`notes-${accent}`} className="mt-2 max-w-[120ch] border-l-2 border-line pl-3 text-xs leading-snug text-ink2">
          {site.note}
        </p>
      )}

      {/* Chart area */}
      <div ref={inner} className="mt-1.5">
        {plan.status === 'loading' && <Skeleton plotH={p.plotH} />}
        {plan.status === 'error' && (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-alert bg-sky p-5" style={{ minHeight: 160 }}>
            <p className="font-semibold text-ink">This plan could not be computed.</p>
            <p className="text-sm text-ink2">{plan.message}</p>
            <button type="button" onClick={p.onRetry} className="rounded-md border border-[#454b57] px-3 py-1.5 text-sm hover:border-ink2">
              Try again
            </button>
          </div>
        )}
        {plan.status === 'ready' && (
          <div className={plan.stale ? 'relative opacity-50' : ''} aria-busy={plan.stale}>
            {plan.stale && (
              <div role="status" className="absolute left-1/2 top-24 z-10 -translate-x-1/2 rounded bg-sky px-3 py-1.5 text-sm text-ink">
                Updating...
              </div>
            )}
            <Ribbon
              width={width}
              data={plan.data}
              view={plan.view}
              heightM={p.heightM}
              range={p.range}
              plotH={p.plotH}
              cursorIdx={plan.view.landingIdx + p.cursor.hours}
              hoverAz={p.hoverAz}
              onHover={p.onHover}
              title={`${p.label}: ${site?.name ?? ''}`}
            />
            <div className="mt-1">
              <MissionStrip
                width={width} data={plan.data} view={plan.view} cursor={p.cursor} label={p.label}
                aside={p.hoverAz !== null ? <HoverLine data={plan} heightM={p.heightM} az={p.hoverAz} /> : undefined}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function HoverLine({ data, heightM, az }: { data: Extract<PlanState, { status: 'ready' }>; heightM: number; az: number }) {
  const r = hoverReadout(data.data.mask, heightM, az);
  return (
    <>
      <span className="text-ink">azimuth {r.az}</span>
      <span>{r.skyline}</span>
      <span>{r.dist}</span>
    </>
  );
}
