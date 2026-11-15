// Scenario toolbar: mission profile, observer height, plan A landing, plan B timing, and the
// requirement sliders behind a disclosure.

import { useEffect, useId, useState, type ReactNode } from 'react';
import { PROFILES } from '../engine/mission';
import { fmtDuration, fmtNum, fmtPct } from '../engine/verdict';
import type { ScenarioApi } from '../state/hooks';
import { HOUR_MS, LIMITS, isModified, type BMode, type HeightM } from '../state/scenario';

const SHORT_LABEL: Record<string, string> = {
  'short-stay': 'Short stay',
  'lunar-day': 'One lunar day',
  'long-rover': 'Long rover',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "2027-10-13 00:00" (UTC). */
export function toIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Parse "YYYY-MM-DD HH:MM" as UTC. Returns the time, or the reason it was refused. */
export function parseIso(text: string): { ms: number } | { error: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return { error: 'Use YYYY-MM-DD HH:MM' };
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) {
    return { error: 'Not a real date and time' };
  }
  if (mi !== 0) return { error: 'Whole hours only: use :00' };
  if (ms < LIMITS.landingMin || ms >= LIMITS.landingMax) return { error: 'Use a date from 2024 to 2039' };
  return { ms };
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink2">{label}</span>
      {children}
    </div>
  );
}

function Segmented<T extends string | number>(props: {
  name: string;
  label: string;
  value: T;
  options: { value: T; text: string }[];
  onChange(v: T): void;
}) {
  return (
    <div role="radiogroup" aria-label={props.label} className="inline-flex h-9 overflow-hidden rounded-md border border-[#454b57]">
      {props.options.map((o, i) => {
        const on = props.value === o.value;
        return (
          <label
            key={String(o.value)}
            className={`flex cursor-pointer items-center whitespace-nowrap px-3 text-[13px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-earth ${i > 0 ? 'border-l border-[#454b57]' : ''} ${on ? 'bg-line font-semibold text-ink shadow-[inset_0_-2px_0_var(--earth)]' : 'text-ink2 hover:bg-[#22262d] hover:text-ink'}`}
          >
            <input
              type="radio"
              name={props.name}
              className="visually-hidden"
              checked={on}
              onChange={() => props.onChange(o.value)}
            />
            {o.text}
          </label>
        );
      })}
    </div>
  );
}

const NUDGES: { text: string; hours: number; label: string }[] = [
  { text: '−1 d', hours: -24, label: 'one day earlier' },
  { text: '−6 h', hours: -6, label: 'six hours earlier' },
  { text: '+6 h', hours: 6, label: 'six hours later' },
  { text: '+1 d', hours: 24, label: 'one day later' },
];

/** A UTC date and time as plain text (YYYY-MM-DD HH:MM), checked on blur or Enter, with nudge buttons. */
function DateTimeUtc({ ms, onChange, label }: { ms: number; onChange(ms: number): void; label: string }) {
  const [draft, setDraft] = useState(toIso(ms));
  const [error, setError] = useState<string | null>(null);
  const errId = useId();

  // Follow the value when it changes from outside (nudges, the landing-date strip, a new link).
  useEffect(() => {
    setDraft(toIso(ms));
    setError(null);
  }, [ms]);

  const commit = () => {
    const r = parseIso(draft);
    if ('error' in r) {
      setError(r.error);
      setDraft(toIso(ms));
      return;
    }
    setError(null);
    if (r.ms !== ms) onChange(r.ms);
    else setDraft(toIso(ms));
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <input
        type="text"
        inputMode="numeric"
        spellCheck={false}
        autoComplete="off"
        aria-label={`${label}, UTC, year-month-day hour:minute`}
        aria-invalid={error !== null}
        aria-describedby={error ? errId : undefined}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setDraft(toIso(ms));
            setError(null);
          }
        }}
        className="mono h-9 w-[10.5rem] !py-0"
      />
      <span className="mono text-[13px] text-ink2">UTC</span>
      <div className="ml-1 flex gap-1" role="group" aria-label={`${label}: nudge`}>
        {NUDGES.map((n) => (
          <button
            key={n.text}
            type="button"
            aria-label={`${label}: ${n.label}`}
            onClick={() => onChange(ms + n.hours * HOUR_MS)}
            className="mono h-9 rounded-md border border-[#454b57] px-1.5 text-xs text-ink hover:border-ink2 hover:bg-[#22262d]"
          >
            {n.text}
          </button>
        ))}
      </div>
      {error && (
        <span id={errId} role="alert" className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-sky px-1.5 text-xs text-alert">
          {error}
        </span>
      )}
    </div>
  );
}

function Slider(props: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange(v: number): void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={props.id} className="text-[13px] text-ink">
          {props.label}
        </label>
        <output htmlFor={props.id} className="mono text-[13px] text-ink">
          {props.display}
        </output>
      </div>
      <input
        id={props.id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        aria-valuetext={props.display}
      />
    </div>
  );
}

export function Controls({ api }: { api: ScenarioApi }) {
  const { s } = api;
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [open, setOpen] = useState(false);
  const modified = isModified(s);
  const preset = PROFILES.find((p) => p.id === s.profileId) ?? PROFILES[0];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    window.setTimeout(() => setCopied('idle'), 2500);
  };

  return (
    <section aria-label="Scenario controls" className="rounded-lg border border-line bg-panel px-4 pb-1.5 pt-2.5">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <Field label="Mission profile">
          <Segmented<string>
            name="profile"
            label="Mission profile"
            value={s.profileId}
            options={PROFILES.map((p) => ({ value: p.id, text: SHORT_LABEL[p.id] ?? p.label }))}
            onChange={api.setProfile}
          />
        </Field>
        <Field label="Observer height">
          <Segmented<HeightM>
            name="height"
            label="Observer height above the ground"
            value={s.heightM}
            options={[
              { value: 2, text: '2 m' },
              { value: 10, text: '10 m' },
            ]}
            onChange={api.setHeight}
          />
        </Field>
        <Field label="Plan A landing">
          <DateTimeUtc ms={s.landingMs} onChange={(ms) => api.setLandingA(ms)} label="Plan A landing" />
        </Field>
        <Field label="Plan B landing">
          <div className="flex items-center gap-2">
            <Segmented<BMode>
              name="bmode"
              label="Plan B landing date"
              value={s.bMode}
              options={[
                { value: 'same', text: 'Same date' },
                { value: 'plus', text: 'A plus N days' },
                { value: 'own', text: 'Own date' },
              ]}
              onChange={api.setBMode}
            />
            {s.bMode === 'plus' && (
              <span className="flex items-center gap-1.5 text-[13px] text-ink2">
                N =
                <input
                  type="number"
                  aria-label="Days after plan A"
                  min={0}
                  max={LIMITS.plusDays.max}
                  step={LIMITS.plusDays.step}
                  value={s.bPlusDays}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) api.setBPlus(v);
                  }}
                  className="mono h-9 w-[4.5rem] !py-0"
                />
                days
              </span>
            )}
            {s.bMode === 'own' && <DateTimeUtc ms={s.bOwnMs} onChange={api.setBOwn} label="Plan B landing" />}
          </div>
        </Field>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-4 pb-1">
      <p className="min-w-0 flex-1 text-xs leading-snug text-ink2">
        <span className="font-semibold text-ink">Where the numbers come from: </span>
        {preset.basis}
      </p>
        <div className="flex shrink-0 items-center gap-2 text-xs">
          <span className="text-ink2" role="status">
            {copied === 'ok' && 'Copied.'}
            {copied === 'fail' && 'Copy failed; use the address bar.'}
          </span>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="requirements-panel"
            onClick={() => setOpen((o) => !o)}
            className="h-7 rounded-md border border-[#454b57] px-2 text-ink hover:border-ink2 hover:bg-[#22262d]"
          >
            {open ? '▾' : '▸'} Adjust requirements{modified ? ' (changed)' : ''}
          </button>
          <button type="button" onClick={copy} className="h-7 rounded-md border border-[#454b57] px-2 text-ink hover:border-ink2 hover:bg-[#22262d]">
            Copy link
          </button>
        </div>
      </div>

      {open && (
        <div id="requirements-panel" className="mt-1 border-t border-line pb-2 pt-3">
          <div className="grid grid-cols-3 gap-x-8 gap-y-2">
            <Slider
              id="req-stay" label="Stay on the surface" min={LIMITS.stayDays.min} max={LIMITS.stayDays.max} step={LIMITS.stayDays.step}
              value={s.stayDays} display={`${fmtNum(s.stayDays, 1)} days`} onChange={api.setStay}
            />
            <Slider
              id="req-dark" label="Longest dark spell allowed" min={0} max={LIMITS.maxDarkGapHours.max} step={LIMITS.maxDarkGapHours.step}
              value={s.maxDarkGapHours} display={s.maxDarkGapHours === 0 ? 'none' : fmtDuration(s.maxDarkGapHours)} onChange={api.setMaxDark}
            />
            <Slider
              id="req-earth" label="Share of stay with Earth in view" min={0} max={1} step={LIMITS.minEarthShare.step}
              value={s.minEarthShare} display={`at least ${fmtPct(s.minEarthShare)}`} onChange={api.setMinEarth}
            />
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-ink2">
            <span>{modified ? 'Changed from the preset above.' : 'Matches the preset above.'}</span>
            {modified && (
              <button type="button" className="rounded border border-[#454b57] px-2 py-0.5 text-ink hover:border-ink2" onClick={() => api.setProfile(s.profileId)}>
                Reset to preset
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
