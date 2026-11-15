// The scenario: everything a person chooses, and its round trip through the URL hash.

import { PROFILES, type MissionProfile } from '../engine/mission';

export const HOUR_MS = 3600000;
export const DAY_MS = 86400000;

export type BMode = 'same' | 'plus' | 'own';
export type HeightM = 1 | 2 | 5 | 10;
export const HEIGHTS: HeightM[] = [1, 2, 5, 10];

export interface Scenario {
  siteA: string;
  siteB: string;
  /** Plan A landing, ms since epoch, UTC, a whole number of hours. */
  landingMs: number;
  profileId: string;
  heightM: HeightM;
  bMode: BMode;
  /** Plan B lands this many days after plan A (mode 'plus'). */
  bPlusDays: number;
  /** Plan B's own landing (mode 'own'). */
  bOwnMs: number;
  /** Requirement sliders. Start from the preset's values. */
  stayDays: number;
  maxDarkGapHours: number;
  minEarthShare: number;
}

/**
 * The scenario the app opens on. Change it here and nowhere else. The equivalent hash is
 * #a=pgda-site23-malapert-massif&b=pgda-site23-malapert-massif&t=20271013T1800Z&p=short-stay&h=2&m=plus&n=3
 * 18:00 was chosen by the clearance rule in pipeline/export-demo-assets.ts (Sun 0.56° above the
 * skyline at landing, against 0.05° at 00:00).
 */
export const DEFAULTS = {
  site: 'pgda-site23-malapert-massif',
  landingMs: Date.UTC(2027, 9, 13, 18, 0),
  profileId: 'short-stay',
  heightM: 2 as HeightM,
  bMode: 'plus' as BMode,
  bPlusDays: 3,
} as const;

export const DEFAULT_SITE: string = DEFAULTS.site;
export const DEFAULT_LANDING_MS: number = DEFAULTS.landingMs;
export const DEFAULT_PROFILE_ID: string = DEFAULTS.profileId;

export const presetOf = (id: string): MissionProfile => PROFILES.find((p) => p.id === id) ?? PROFILES[1];

/** A scenario using a preset's numbers unchanged. */
export function withPreset(s: Scenario, profileId: string): Scenario {
  const p = presetOf(profileId);
  return { ...s, profileId: p.id, stayDays: p.stayDays, maxDarkGapHours: p.maxDarkGapHours, minEarthShare: p.minEarthShare };
}

export function defaultScenario(): Scenario {
  const p = presetOf(DEFAULT_PROFILE_ID);
  return {
    siteA: DEFAULT_SITE,
    siteB: DEFAULT_SITE,
    landingMs: DEFAULT_LANDING_MS,
    profileId: p.id,
    heightM: DEFAULTS.heightM,
    bMode: DEFAULTS.bMode,
    bPlusDays: DEFAULTS.bPlusDays,
    bOwnMs: DEFAULT_LANDING_MS + DEFAULTS.bPlusDays * DAY_MS,
    stayDays: p.stayDays,
    maxDarkGapHours: p.maxDarkGapHours,
    minEarthShare: p.minEarthShare,
  };
}

/** The profile the sliders currently describe. */
export function effectiveProfile(s: Scenario): MissionProfile {
  const base = presetOf(s.profileId);
  return { ...base, stayDays: s.stayDays, maxDarkGapHours: s.maxDarkGapHours, minEarthShare: s.minEarthShare };
}

export function isModified(s: Scenario): boolean {
  const base = presetOf(s.profileId);
  return base.stayDays !== s.stayDays || base.maxDarkGapHours !== s.maxDarkGapHours || base.minEarthShare !== s.minEarthShare;
}

export function landingBMs(s: Scenario): number {
  if (s.bMode === 'own') return s.bOwnMs;
  return s.landingMs + (s.bMode === 'same' ? 0 : s.bPlusDays) * DAY_MS;
}

// --- URL hash -------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 20270301T0000Z */
export function msToStamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
}

export function stampToMs(s: string | null): number | null {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], 0);
  return Number.isFinite(ms) ? ms : null;
}

const num = (v: string | null): number | null => {
  if (v === null || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const LIMITS = {
  stayDays: { min: 1, max: 100, step: 0.5 },
  maxDarkGapHours: { min: 0, max: 240, step: 6 },
  minEarthShare: { min: 0, max: 1, step: 0.05 },
  plusDays: { min: 0, max: 365, step: 0.25 },
  /** Landing times are held to this range so the series stays a sensible length. */
  landingMin: Date.UTC(2024, 0, 1),
  landingMax: Date.UTC(2040, 0, 1),
} as const;

export function encodeScenario(s: Scenario): string {
  const p = new URLSearchParams();
  p.set('a', s.siteA);
  p.set('b', s.siteB);
  p.set('t', msToStamp(s.landingMs));
  p.set('p', s.profileId);
  p.set('h', String(s.heightM));
  p.set('m', s.bMode);
  if (s.bMode === 'plus') p.set('n', String(s.bPlusDays));
  if (s.bMode === 'own') p.set('bt', msToStamp(s.bOwnMs));
  const base = presetOf(s.profileId);
  if (s.stayDays !== base.stayDays) p.set('stay', String(s.stayDays));
  if (s.maxDarkGapHours !== base.maxDarkGapHours) p.set('gap', String(s.maxDarkGapHours));
  if (s.minEarthShare !== base.minEarthShare) p.set('earth', String(s.minEarthShare));
  return p.toString();
}

/** Parse a hash; anything missing or invalid falls back to the default scenario. */
export function decodeScenario(hash: string): Scenario {
  const d = defaultScenario();
  const raw = hash.replace(/^#/, '');
  if (!raw) return d;
  const p = new URLSearchParams(raw);
  const prof = PROFILES.find((x) => x.id === p.get('p'));
  const s: Scenario = { ...(prof ? withPreset(d, prof.id) : d) };
  s.siteA = p.get('a') || d.siteA;
  s.siteB = p.get('b') || p.get('a') || d.siteB;
  const t = stampToMs(p.get('t'));
  if (t !== null) s.landingMs = clamp(t, LIMITS.landingMin, LIMITS.landingMax);
  const h = num(p.get('h'));
  if (h === 1 || h === 2 || h === 5 || h === 10) s.heightM = h;
  const m = p.get('m');
  if (m === 'same' || m === 'plus' || m === 'own') s.bMode = m;
  const n = num(p.get('n'));
  s.bPlusDays = n === null ? (p.has('m') ? 0 : d.bPlusDays) : clamp(Math.round(n * 4) / 4, 0, 365);
  const bt = stampToMs(p.get('bt'));
  s.bOwnMs = bt === null ? s.landingMs + DEFAULTS.bPlusDays * DAY_MS : clamp(bt, LIMITS.landingMin, LIMITS.landingMax);
  const stay = num(p.get('stay'));
  if (stay !== null) s.stayDays = clamp(stay, LIMITS.stayDays.min, LIMITS.stayDays.max);
  const gap = num(p.get('gap'));
  if (gap !== null) s.maxDarkGapHours = clamp(gap, 0, LIMITS.maxDarkGapHours.max);
  const earth = num(p.get('earth'));
  if (earth !== null) s.minEarthShare = clamp(earth, 0, 1);
  return s;
}
