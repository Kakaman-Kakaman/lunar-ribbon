// Plain-language verdicts: turn an Evaluation into the sentences a person reads.
//
// Everything here is a pure function of numbers the engine already produced. The wording
// follows "Words" in docs/ARCHITECTURE.md: plain language, a unit on every number, the
// terrain source named, and for a dark spell the compass direction of the Sun and the
// distance to the terrain that hides it (when the skyline mask carries distKm).

import type { Evaluation, MissionProfile } from './mission';
import type { HorizonMask } from './horizon';
import { darkSpans } from './ribbonGeometry';
import { timeToNextRise, type SiteSeries } from './visibility';

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const EPS = 1e-9;

export type TerrainSource = HorizonMask['terrain'];

// ---------------------------------------------------------------------------------------
// Formatting helpers (also used by the interface)
// ---------------------------------------------------------------------------------------

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A number with at most `digits` decimals, trailing zeros dropped. */
export function fmtNum(x: number, digits = 1): string {
  const s = x.toFixed(digits);
  return digits > 0 ? s.replace(/\.?0+$/, '') : s;
}

/**
 * The one duration formatter for the whole interface. Under 48 hours: hours, one decimal below
 * 10 hours ("1.7 hours", "18 hours"). 48 hours or more: days with one decimal ("6.2 days").
 */
export function fmtDuration(hours: number): string {
  const h = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  if (h < 48) return `${fmtNum(h, 1)} ${h === 1 ? 'hour' : 'hours'}`;
  const d = Math.round((hours / 24) * 10) / 10;
  return `${fmtNum(d, 1)} ${d === 1 ? 'day' : 'days'}`;
}

/**
 * How far a body's centre sits above or below the skyline, for the live label on the ribbon.
 * Within 0.1 degrees either way it reads "just above" or "just below" rather than a signed zero.
 */
export function clearanceText(deg: number): string {
  if (Math.abs(deg) < 0.1) return deg >= 0 ? 'just above skyline' : 'just below skyline';
  return deg > 0 ? `+${deg.toFixed(1)}° above skyline` : `${(-deg).toFixed(1)}° below skyline`;
}

/** "14 March 2027" (UTC). */
export function fmtDateUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "14 Mar 2027" (UTC). */
export function fmtDateShortUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2027-03-01 00:00 UTC". */
export function fmtDateTimeUtc(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

export const fmtPct = (share: number) => `${Math.round(share * 100)}%`;

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** Eight-point compass name for an azimuth in degrees clockwise from north. */
export function compassName(azDeg: number): string {
  const a = ((azDeg % 360) + 360) % 360;
  return COMPASS[Math.round(a / 45) % 8];
}

/** One line naming where the skyline data came from. */
export function terrainLabel(t: TerrainSource): string {
  switch (t) {
    case 'lola-80m+240m':
      return 'Terrain: NASA LOLA elevation grids (80 m near the site, 240 m beyond)';
    case 'lola-240m':
      return 'Terrain: NASA LOLA elevation grid (240 m)';
    case 'lola-480m':
      return 'Terrain: NASA LOLA elevation grid (480 m)';
    case 'smooth-sphere':
      return 'No terrain: geometric estimate';
  }
}

/** Short badge text. */
export function terrainBadge(t: TerrainSource): string {
  return t === 'smooth-sphere' ? 'No terrain: geometric estimate' : t === 'lola-80m+240m' ? 'NASA LOLA terrain, 80 m' : t === 'lola-240m' ? 'NASA LOLA terrain, 240 m' : 'NASA LOLA terrain, 480 m';
}

/** Distance to the terrain that sets the skyline at an azimuth, km; null if the mask has none. */
export function obstructionKmAt(mask: HorizonMask, heightM: number, azDeg: number): number | null {
  const d = mask.distKm?.[String(heightM)];
  if (!d || d.length === 0) return null;
  const i = Math.round((((azDeg % 360) + 360) % 360) / mask.azStepDeg) % d.length;
  const v = d[i];
  return Number.isFinite(v) ? v : null;
}

// ---------------------------------------------------------------------------------------
// Context for a failure
// ---------------------------------------------------------------------------------------

export interface FailureContext {
  /** Sun azimuth (deg clockwise from north) at the moment the Sun requirement breaks. */
  sunAzDeg: number | null;
  /** Distance to the terrain that sets the skyline at that azimuth, km. */
  sunObstructionKm: number | null;
  /** Length of the whole dark spell, days (measured to the Sun's return, or the end of the series). */
  darkSpellDays: number | null;
  /** Hours of that same spell that fall inside the stay; null when not known. */
  darkSpellInStayH?: number | null;
  /** Hours after landing until the Sun is up again; null if it never is within the series. */
  sunReturnsAfterH: number | null;
  earthAzDeg: number | null;
  earthObstructionKm: number | null;
  earthReturnsAfterH: number | null;
}

export const EMPTY_CONTEXT: FailureContext = {
  sunAzDeg: null,
  sunObstructionKm: null,
  darkSpellDays: null,
  sunReturnsAfterH: null,
  earthAzDeg: null,
  earthObstructionKm: null,
  earthReturnsAfterH: null,
};

/** Gather what the sentences need to say where the Sun (or Earth) disappears and why. */
export function failureContext(
  series: SiteSeries,
  mask: HorizonMask,
  heightM: number,
  landingIndex: number,
  ev: Evaluation,
  profile: MissionProfile,
): FailureContext {
  const ctx: FailureContext = { ...EMPTY_CONTEXT };
  const { stepMs } = series;
  const stepH = stepMs / HOUR_MS;
  const stayN = Math.max(1, Math.round((profile.stayDays * DAY_MS) / stepMs));
  const L = landingIndex;
  const at = (i: number) => Math.min(series.n - 1, Math.max(0, i));

  if (ev.failures.includes('sun-down-at-landing')) {
    ctx.sunAzDeg = series.sunAz[at(L)];
    ctx.sunObstructionKm = obstructionKmAt(mask, heightM, ctx.sunAzDeg);
    const up = timeToNextRise(series.sunFrac, L, stepMs);
    ctx.sunReturnsAfterH = up === null ? null : up / HOUR_MS;
    const span = darkSpans(series, L, Math.min(series.n, L + stayN + 30 * 24)).find((s) => s.startMs <= series.startMs + L * stepMs + 1);
    ctx.darkSpellDays = span ? span.days : null;
  } else if (ev.failures.includes('dark-gap') && ev.firstFailureAfterH !== null) {
    // firstFailureAfterH = start of the dark run + the allowed gap.
    const startIdx = L + Math.round((ev.firstFailureAfterH - profile.maxDarkGapHours) / stepH);
    const i0 = at(startIdx);
    ctx.sunAzDeg = series.sunAz[i0];
    ctx.sunObstructionKm = obstructionKmAt(mask, heightM, ctx.sunAzDeg);
    const startMs = series.startMs + i0 * stepMs;
    const spans = darkSpans(series, L, Math.min(series.n, L + stayN + 30 * 24));
    const span = spans.find((s) => s.startMs <= startMs + stepMs && s.endMs >= startMs);
    ctx.darkSpellDays = span ? span.days : null;
    if (span) {
      const stayEndMs = series.startMs + (L + stayN) * stepMs;
      const landingMs = series.startMs + L * stepMs;
      ctx.darkSpellInStayH = Math.max(0, Math.min(span.endMs, stayEndMs) - Math.max(span.startMs, landingMs)) / HOUR_MS;
    }
  }

  if (ev.failures.includes('earth-down-at-landing')) {
    ctx.earthAzDeg = series.earthAz[at(L)];
    ctx.earthObstructionKm = obstructionKmAt(mask, heightM, ctx.earthAzDeg);
    const up = timeToNextRise(series.earthFrac, L, stepMs);
    ctx.earthReturnsAfterH = up === null ? null : up / HOUR_MS;
  }
  return ctx;
}

// ---------------------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------------------

export interface VerdictInput {
  ev: Evaluation;
  profile: MissionProfile;
  /** How long the landing can be delayed with every later slot still working, ms. */
  slipMarginMs: number;
  /** True if the slip margin runs to the end of the scanned year. */
  slipToScanEnd?: boolean;
  /** First landing slot that works at or after the chosen landing; null if none. */
  nextWindowStartMs: number | null;
  landingMs: number;
  terrain: TerrainSource;
  ctx?: FailureContext;
}

export interface Verdict {
  ok: boolean;
  /** "Works" or "Fails": shown with a shape, never alone as colour. */
  word: 'Works' | 'Fails';
  /** The sentences, in reading order. */
  sentences: string[];
  /** The sentences joined, prefixed with the word. */
  text: string;
  /** Where the terrain came from. */
  source: string;
}

const stayPhrase = (p: MissionProfile) => `${fmtNum(p.stayDays, 1)}-day stay`;

function allowance(p: MissionProfile): string {
  return p.maxDarkGapHours <= 0 ? 'allows none' : `allows up to ${fmtDuration(p.maxDarkGapHours)}`;
}

/** "behind terrain 34 km to the north-east" / "below the geometric horizon to the north-east". */
function hidingPhrase(az: number | null, km: number | null, terrain: TerrainSource): string {
  const dir = az === null ? '' : ` to the ${compassName(az)}`;
  if (terrain === 'smooth-sphere') return `goes below the geometric horizon${dir}`;
  if (km === null) return `goes behind terrain${dir}`;
  return `goes behind terrain ${fmtNum(km, km < 10 ? 1 : 0)} km away${dir}`;
}

function failureSentences(i: VerdictInput): string[] {
  const { ev, profile: p, terrain } = i;
  const ctx = i.ctx ?? EMPTY_CONTEXT;
  const out: string[] = [];
  const first = ev.failures[0];
  const when =
    ev.firstFailureAfterH === null || ev.firstFailureAfterH <= 0
      ? 'Fails at landing.'
      : `Fails ${fmtDuration(ev.firstFailureAfterH)} after landing.`;

  const sunDownAtLanding = ev.failures.includes('sun-down-at-landing');
  const earthDownAtLanding = ev.failures.includes('earth-down-at-landing');

  if (sunDownAtLanding) {
    const dir = ctx.sunAzDeg === null ? '' : ` in the ${compassName(ctx.sunAzDeg)}`;
    const why =
      terrain === 'smooth-sphere'
        ? `The Sun is below the geometric horizon${dir} at landing.`
        : ctx.sunObstructionKm === null
          ? `The Sun${dir} is hidden by terrain at landing.`
          : `The Sun${dir} is hidden at landing by terrain ${fmtNum(ctx.sunObstructionKm, ctx.sunObstructionKm < 10 ? 1 : 0)} km away.`;
    const back =
      ctx.sunReturnsAfterH === null
        ? 'It does not clear the skyline in the time covered.'
        : `It clears the skyline ${fmtDuration(ctx.sunReturnsAfterH)} later.`;
    out.push(when, why, back);
  } else if (earthDownAtLanding && first === 'earth-down-at-landing') {
    const dir = ctx.earthAzDeg === null ? '' : ` in the ${compassName(ctx.earthAzDeg)}`;
    out.push(
      when,
      `Earth${dir} is below the skyline at landing, so there is no direct radio link.`,
      ctx.earthReturnsAfterH === null
        ? 'It does not rise in the time covered.'
        : `Earth rises ${fmtDuration(ctx.earthReturnsAfterH)} later.`,
    );
  } else if (first === 'dark-gap') {
    const spellH = ctx.darkSpellDays === null ? null : ctx.darkSpellDays * 24;
    let spell = spellH === null ? '' : ` and stays hidden for ${fmtDuration(spellH)}`;
    // When the spell runs past the end of the stay, say which number is which.
    if (spellH !== null && ctx.darkSpellInStayH != null && ctx.darkSpellInStayH < spellH - 0.5) {
      const inStay = fmtDuration(ctx.darkSpellInStayH);
      spell += `; ${inStay} of that ${/^1 /.test(inStay) ? 'falls' : 'fall'} inside the stay`;
    }
    out.push(
      when,
      `The Sun ${hidingPhrase(ctx.sunAzDeg, ctx.sunObstructionKm, terrain)}${spell}.`,
      `This mission profile ${allowance(p)}.`,
    );
    if (ctx.darkSpellDays !== null && ev.longestDarkGapH > ctx.darkSpellDays * 24 + 1) {
      out.push(`The longest dark spell in the stay is ${fmtDuration(ev.longestDarkGapH)}.`);
    }
  } else if (first === 'earth-share') {
    out.push(
      when,
      `Earth is in view for ${fmtPct(ev.earthShare)} of the ${stayPhrase(p)}; this mission profile needs at least ${fmtPct(p.minEarthShare)}.`,
      `The longest stretch without Earth is ${fmtDuration(ev.longestEarthGapH)}.`,
    );
  }

  // Other failures, one short sentence each.
  if (ev.failures.includes('dark-gap') && first !== 'dark-gap') {
    out.push(`The longest dark spell in the stay is ${fmtDuration(ev.longestDarkGapH)}, and this mission profile ${allowance(p)}.`);
  }
  if (earthDownAtLanding && first !== 'earth-down-at-landing') {
    out.push('Earth is also below the skyline at landing.');
  }
  if (ev.failures.includes('earth-share') && first !== 'earth-share') {
    out.push(`Earth is in view for only ${fmtPct(ev.earthShare)} of the stay; ${fmtPct(p.minEarthShare)} is needed.`);
  }
  return out;
}

function worksSentences(i: VerdictInput): string[] {
  const { ev, profile: p } = i;
  const out: string[] = [];
  const sunFull = ev.sunShare >= 1 - EPS;
  const earthFull = ev.earthShare >= 1 - EPS;
  const sun = sunFull
    ? `The Sun stays up for the whole ${stayPhrase(p)}`
    : `The Sun is up for ${fmtPct(ev.sunShare)} of the ${stayPhrase(p)}, and its longest dark spell, ${fmtDuration(ev.longestDarkGapH)}, is within the ${fmtDuration(p.maxDarkGapHours)} this mission profile allows`;
  const earth = earthFull
    ? 'Earth is in view throughout'
    : `Earth is in view for ${fmtPct(ev.earthShare)} of the stay, at or above the ${fmtPct(p.minEarthShare)} needed`;
  out.push(`${sun}${sunFull && earthFull ? ' and ' : '. '}${earth}.`);
  if (i.slipMarginMs > 0) {
    const d = fmtDuration(i.slipMarginMs / HOUR_MS);
    out.push(
      i.slipToScanEnd
        ? `The landing can slip by ${d}, to the end of the year scanned, and still work.`
        : `The landing can slip up to ${d}.`,
    );
  } else {
    out.push('The landing has no room to slip: a delay of 6 hours already breaks a requirement.');
  }
  return out;
}

/** The sentences for one plan. */
export function describeVerdict(i: VerdictInput): Verdict {
  const source = terrainLabel(i.terrain);
  const sentences = i.ev.ok ? worksSentences(i) : failureSentences(i);
  if (!i.ev.ok) {
    if (i.nextWindowStartMs === null) {
      sentences.push('No landing date in the following year works for this mission profile.');
    } else {
      const later = (i.nextWindowStartMs - i.landingMs) / HOUR_MS;
      sentences.push(
        `Next landing date that works: ${fmtDateUtc(i.nextWindowStartMs)}${later > 0 ? `, ${fmtDuration(later)} later` : ''}.`,
      );
    }
  }
  if (i.terrain === 'smooth-sphere') sentences.push('This is a geometric estimate with no terrain.');
  const word = i.ev.ok ? 'Works' : 'Fails';
  // For a pass the word stands in front of the sentence; for a failure the first sentence already
  // says "Fails ...", so the word is not repeated.
  const text = i.ev.ok ? `Works. ${sentences.join(' ')}` : sentences.join(' ');
  return { ok: i.ev.ok, word, sentences, text, source };
}

// ---------------------------------------------------------------------------------------
// Comparison of two plans
// ---------------------------------------------------------------------------------------

export interface PlanSummary {
  siteName: string;
  landingMs: number;
  ev: Evaluation;
  slipMarginMs: number;
  profile: MissionProfile;
}

function reason(s: PlanSummary): string {
  const { ev } = s;
  const first = ev.failures[0];
  switch (first) {
    case 'sun-down-at-landing':
      return 'the Sun is hidden at landing';
    case 'earth-down-at-landing':
      return 'Earth is below the skyline at landing';
    case 'dark-gap':
      return `the Sun is hidden for ${fmtDuration(ev.longestDarkGapH)} of the stay, longer than this mission profile allows`;
    case 'earth-share':
      return `Earth is in view for only ${fmtPct(ev.earthShare)} of the stay`;
    default:
      return 'a requirement is broken';
  }
}

/** One sentence (two at most) comparing plan A with plan B. */
export function compareSentence(a: PlanSummary, b: PlanSummary): string {
  const parts: string[] = [];
  const same = a.siteName === b.siteName;
  const dMs = b.landingMs - a.landingMs;
  if (same && Math.abs(dMs) > 1) {
    const later = dMs > 0;
    parts.push(`Plan B lands at the same site ${fmtDuration(Math.abs(dMs) / HOUR_MS)} ${later ? 'after' : 'before'} plan A.`);
  } else if (!same) {
    parts.push(Math.abs(dMs) > 1 ? 'The plans differ in site and landing date.' : 'The plans differ in site.');
  }

  if (a.ev.ok && b.ev.ok) {
    const sa = a.slipMarginMs / DAY_MS, sb = b.slipMarginMs / DAY_MS;
    if (Math.abs(sa - sb) < 1e-6) {
      parts.push(`Both work, and both can slip up to ${fmtDuration(a.slipMarginMs / HOUR_MS)}.`);
    } else {
      const wider = sa > sb ? 'A' : 'B';
      parts.push(
        `Both work. Plan A can slip up to ${fmtDuration(a.slipMarginMs / HOUR_MS)} and plan B up to ${fmtDuration(b.slipMarginMs / HOUR_MS)}, so plan ${wider} has more room.`,
      );
    }
  } else if (a.ev.ok !== b.ev.ok) {
    const [okP, badP, okL, badL] = a.ev.ok ? [a, b, 'A', 'B'] : [b, a, 'B', 'A'];
    parts.push(
      `Plan ${okL} works and plan ${badL} fails because ${reason(badP)}; the Sun is up for ${fmtPct(okP.ev.sunShare)} of the stay in plan ${okL} against ${fmtPct(badP.ev.sunShare)} in plan ${badL}.`,
    );
  } else {
    parts.push(`Both fail: plan A because ${reason(a)}, plan B because ${reason(b)}.`);
  }
  return parts.join(' ');
}
