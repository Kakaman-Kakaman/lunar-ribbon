// Tests for the wording of verdicts. Evaluations are written by hand so each sentence can be checked.

import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTEXT,
  compareSentence,
  compassName,
  describeVerdict,
  failureContext,
  clearanceText,
  fmtDuration,
  obstructionKmAt,
  terrainLabel,
  type PlanSummary,
  type VerdictInput,
} from '../src/engine/verdict';
import { PROFILES, evaluate, type Evaluation } from '../src/engine/mission';
import type { HorizonMask } from '../src/engine/horizon';
import type { SiteSeries } from '../src/engine/visibility';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2027, 2, 1);
const byId = (id: string) => PROFILES.find((p) => p.id === id)!;

const okEv: Evaluation = {
  ok: true, failures: [], sunShare: 1, earthShare: 1, bothShare: 1,
  longestDarkGapH: 0, longestEarthGapH: 0,
  firstSunsetAfterH: null, firstEarthsetAfterH: null, firstFailureAfterH: null,
};

const input = (over: Partial<VerdictInput>): VerdictInput => ({
  ev: okEv,
  profile: byId('short-stay'),
  slipMarginMs: 3 * DAY,
  nextWindowStartMs: null,
  landingMs: T0,
  terrain: 'lola-80m+240m',
  ...over,
});

describe('helpers', () => {
  it('formats durations with one rule: hours under 48 h (one decimal below 10 h), days from 48 h', () => {
    expect(fmtDuration(6)).toBe('6 hours');
    expect(fmtDuration(1)).toBe('1 hour');
    expect(fmtDuration(0)).toBe('0 hours');
    expect(fmtDuration(1.7)).toBe('1.7 hours');
    expect(fmtDuration(9.96)).toBe('10 hours');
    expect(fmtDuration(18)).toBe('18 hours');
    expect(fmtDuration(18.4)).toBe('18 hours');
    expect(fmtDuration(24)).toBe('24 hours');
    expect(fmtDuration(47.4)).toBe('47 hours');
    expect(fmtDuration(47.6)).toBe('2 days');
    expect(fmtDuration(48)).toBe('2 days');
    expect(fmtDuration(50.4)).toBe('2.1 days');
    expect(fmtDuration(72)).toBe('3 days');
    expect(fmtDuration(149)).toBe('6.2 days');
  });
  it('says "just above" or "just below" the skyline instead of a signed zero', () => {
    expect(clearanceText(1.24)).toBe('+1.2° above skyline');
    expect(clearanceText(-0.44)).toBe('0.4° below skyline');
    expect(clearanceText(0.04)).toBe('just above skyline');
    expect(clearanceText(0)).toBe('just above skyline');
    expect(clearanceText(-0.04)).toBe('just below skyline');
    expect(clearanceText(0.1)).toBe('+0.1° above skyline');
    expect(clearanceText(-0.1)).toBe('0.1° below skyline');
  });
  it('names compass directions clockwise from north', () => {
    expect(compassName(0)).toBe('north');
    expect(compassName(44)).toBe('north-east');
    expect(compassName(90)).toBe('east');
    expect(compassName(181)).toBe('south');
    expect(compassName(270)).toBe('west');
    expect(compassName(359)).toBe('north');
    expect(compassName(-45)).toBe('north-west');
  });
  it('labels a smooth sphere as a geometric estimate', () => {
    expect(terrainLabel('smooth-sphere')).toBe('No terrain: geometric estimate');
    expect(terrainLabel('lola-80m+240m')).toContain('NASA LOLA');
  });
  it('reads the obstruction distance by azimuth', () => {
    const mask = {
      azStepDeg: 0.5,
      distKm: { '2': Array.from({ length: 720 }, (_, i) => i) },
    } as unknown as HorizonMask;
    expect(obstructionKmAt(mask, 2, 45)).toBe(90);
    expect(obstructionKmAt(mask, 2, 359.9)).toBe(0); // wraps to index 0
    expect(obstructionKmAt(mask, 10, 45)).toBeNull();
    expect(obstructionKmAt({ azStepDeg: 0.5 } as HorizonMask, 2, 45)).toBeNull();
  });
});

describe('describeVerdict: works', () => {
  it('says the Sun stays up, Earth is in view, and how far the landing can slip', () => {
    const v = describeVerdict(input({}));
    expect(v.ok).toBe(true);
    expect(v.word).toBe('Works');
    expect(v.text).toBe(
      'Works. The Sun stays up for the whole 6.5-day stay and Earth is in view throughout. The landing can slip up to 3 days.',
    );
  });
  it('states partial Earth share and the dark spell within the limit', () => {
    const v = describeVerdict(
      input({
        profile: byId('long-rover'),
        ev: { ...okEv, sunShare: 0.91, earthShare: 0.83, longestDarkGapH: 55 },
        slipMarginMs: 0,
      }),
    );
    expect(v.text).toContain('The Sun is up for 91% of the 100-day stay');
    expect(v.text).toContain('2.3 days, is within the 4 days this mission profile allows');
    expect(v.text).toContain('Earth is in view for 83% of the stay, at or above the 50% needed');
    expect(v.text).toContain('no room to slip');
  });
  it('says so when the slip margin runs to the end of the scan', () => {
    const v = describeVerdict(input({ slipToScanEnd: true }));
    expect(v.text).toContain('to the end of the year scanned');
  });
});

describe('describeVerdict: failures', () => {
  const failing = (over: Partial<Evaluation>): Evaluation => ({ ...okEv, ok: false, ...over });

  it('dark gap: time, direction, distance, length, and what the profile allows', () => {
    const v = describeVerdict(
      input({
        ev: failing({ failures: ['dark-gap'], sunShare: 0.7, longestDarkGapH: 50, firstFailureAfterH: 5 * 24 + 8 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 45, sunObstructionKm: 34, darkSpellDays: 2.1 },
        nextWindowStartMs: Date.UTC(2027, 2, 14),
        landingMs: Date.UTC(2027, 1, 15, 12),
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.word).toBe('Fails');
    expect(v.text).toContain('Fails 5.3 days after landing.');
    expect(v.text).toContain('The Sun goes behind terrain 34 km away to the north-east and stays hidden for 2.1 days.');
    expect(v.text).toContain('This mission profile allows none.');
    expect(v.text).toContain('Next landing date that works: 14 March 2027, 26.5 days later.');
    expect(v.text).not.toContain('inside the stay');
  });
  it('dark gap names the longest spell when a later one is longer', () => {
    const v = describeVerdict(
      input({
        ev: failing({ failures: ['dark-gap'], longestDarkGapH: 149, firstFailureAfterH: 108 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 225, sunObstructionKm: 42, darkSpellDays: 1.7 / 24 },
      }),
    );
    expect(v.text).toContain('stays hidden for 1.7 hours');
    expect(v.text).toContain('The longest dark spell in the stay is 6.2 days.');
  });
  it('dark gap with an allowance names the allowance', () => {
    const v = describeVerdict(
      input({
        profile: byId('long-rover'),
        ev: failing({ failures: ['dark-gap'], longestDarkGapH: 120, firstFailureAfterH: 200 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 200, sunObstructionKm: 8.25, darkSpellDays: 5 },
      }),
    );
    expect(v.text).toContain('terrain 8.3 km away to the south');
    expect(v.text).toContain('allows up to 4 days');
  });
  it('dark gap without distance data leaves the distance out', () => {
    const v = describeVerdict(
      input({
        ev: failing({ failures: ['dark-gap'], firstFailureAfterH: 30 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 90, darkSpellDays: 1 },
      }),
    );
    expect(v.text).toContain('goes behind terrain to the east and stays hidden for 24 hours');
    expect(v.text).not.toContain('km');
  });
  it('Sun down at landing', () => {
    const v = describeVerdict(
      input({
        ev: failing({ failures: ['sun-down-at-landing'], firstFailureAfterH: 0 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 315, sunObstructionKm: 12.4, sunReturnsAfterH: 40 },
        nextWindowStartMs: T0 + 3 * DAY,
      }),
    );
    expect(v.text).toContain('Fails at landing.');
    expect(v.text).toContain('The Sun in the north-west is hidden at landing by terrain 12 km away.');
    expect(v.text).toContain('It clears the skyline 40 hours later.');
    expect(v.text).toContain('Next landing date that works: 4 March 2027, 3 days later.');
  });
  it('Earth down at landing says there is no direct radio link', () => {
    const v = describeVerdict(
      input({
        ev: failing({ failures: ['earth-down-at-landing'], firstFailureAfterH: 0 }),
        ctx: { ...EMPTY_CONTEXT, earthAzDeg: 10, earthReturnsAfterH: 12 },
      }),
    );
    expect(v.text).toContain('Fails at landing.');
    expect(v.text).toContain('Earth in the north is below the skyline at landing, so there is no direct radio link.');
    expect(v.text).toContain('Earth rises 12 hours later.');
  });
  it('Earth share', () => {
    const v = describeVerdict(
      input({
        profile: byId('lunar-day'),
        ev: failing({ failures: ['earth-share'], earthShare: 0.62, longestEarthGapH: 74, firstFailureAfterH: 100 }),
      }),
    );
    expect(v.text).toContain('Fails 4.2 days after landing.');
    expect(v.text).toContain('Earth is in view for 62% of the 14-day stay; this mission profile needs at least 75%.');
    expect(v.text).toContain('The longest stretch without Earth is 3.1 days.');
  });
  it('reports every extra failure', () => {
    const v = describeVerdict(
      input({
        profile: byId('lunar-day'),
        ev: failing({
          failures: ['sun-down-at-landing', 'earth-down-at-landing', 'dark-gap', 'earth-share'],
          earthShare: 0.5,
          longestDarkGapH: 30,
          firstFailureAfterH: 0,
        }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 0, sunReturnsAfterH: 5 },
      }),
    );
    expect(v.text).toContain('Earth is also below the skyline at landing.');
    expect(v.text).toContain('The longest dark spell in the stay is 30 hours, and this mission profile allows none');
    expect(v.text).toContain('Earth is in view for only 50% of the stay');
  });
  it('says when no later landing date works', () => {
    const v = describeVerdict(input({ ev: failing({ failures: ['dark-gap'], firstFailureAfterH: 10 }) }));
    expect(v.text).toContain('No landing date in the following year works');
  });
  it('a smooth-sphere result says it is a geometric estimate and does not claim terrain', () => {
    const v = describeVerdict(
      input({
        terrain: 'smooth-sphere',
        ev: failing({ failures: ['dark-gap'], firstFailureAfterH: 100 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 270, sunObstructionKm: null, darkSpellDays: 14 },
      }),
    );
    expect(v.source).toBe('No terrain: geometric estimate');
    expect(v.text).toContain('goes below the geometric horizon to the west');
    expect(v.text).toContain('geometric estimate');
    expect(v.text).not.toContain('behind terrain');
  });
});

describe('wording: which number is which when a dark spell runs past the stay', () => {
  const failing = (over: Partial<Evaluation>): Evaluation => ({ ...okEv, ok: false, ...over });

  it('the verdict names both the whole spell and the part inside the stay', () => {
    const v = describeVerdict(
      input({
        ev: failing({ failures: ['dark-gap'], sunShare: 0.9, longestDarkGapH: 18, firstFailureAfterH: 138 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 0, sunObstructionKm: 21, darkSpellDays: 1.8, darkSpellInStayH: 18 },
      }),
    );
    expect(v.text).toContain('stays hidden for 43 hours; 18 hours of that fall inside the stay.');
  });
  it('says "falls" for a single hour and stays silent when the spell ends inside the stay', () => {
    const one = describeVerdict(
      input({
        ev: failing({ failures: ['dark-gap'], longestDarkGapH: 1, firstFailureAfterH: 100 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 0, darkSpellDays: 3, darkSpellInStayH: 1 },
      }),
    );
    expect(one.text).toContain('1 hour of that falls inside the stay');
    const inside = describeVerdict(
      input({
        ev: failing({ failures: ['dark-gap'], longestDarkGapH: 50, firstFailureAfterH: 100 }),
        ctx: { ...EMPTY_CONTEXT, sunAzDeg: 0, darkSpellDays: 2, darkSpellInStayH: 48 },
      }),
    );
    expect(inside.text).not.toContain('inside the stay');
  });
  it('the comparison uses the in-stay figure and says "of the stay"', () => {
    const a: PlanSummary = { siteName: 'S', landingMs: T0, ev: okEv, slipMarginMs: DAY, profile: byId('short-stay') };
    const b: PlanSummary = { ...a, landingMs: T0 + 3 * DAY, ev: failing({ failures: ['dark-gap'], sunShare: 0.9, longestDarkGapH: 18, firstFailureAfterH: 138 }) };
    const s = compareSentence(a, b);
    expect(s).toContain('the Sun is hidden for 18 hours of the stay');
    expect(s).not.toContain('1.8 days');
  });
  it('the verdict and the comparison agree on the in-stay figure', () => {
    const ev = failing({ failures: ['dark-gap'], sunShare: 0.9, longestDarkGapH: 18, firstFailureAfterH: 138 });
    const v = describeVerdict(input({ ev, ctx: { ...EMPTY_CONTEXT, sunAzDeg: 0, darkSpellDays: 1.8, darkSpellInStayH: 18 } }));
    const s = compareSentence({ siteName: 'S', landingMs: T0, ev: okEv, slipMarginMs: DAY, profile: byId('short-stay') }, { siteName: 'S', landingMs: T0 + DAY, ev, slipMarginMs: 0, profile: byId('short-stay') });
    expect(v.text).toContain('18 hours');
    expect(s).toContain('18 hours');
  });
});

describe('failureContext', () => {
  const n = 24 * 40;
  function series(): SiteSeries {
    const z = () => new Float32Array(n);
    const s: SiteSeries = {
      startMs: T0, stepMs: HOUR, n,
      sunAz: z(), sunEl: z(), sunHorizon: z(), sunFrac: z(),
      earthAz: z(), earthEl: z(), earthHorizon: z(), earthFrac: z(),
    };
    for (let i = 0; i < n; i++) {
      s.sunFrac[i] = i >= 48 && i < 96 ? 0 : 1; // dark from hour 48 to 96 (2 days)
      s.earthFrac[i] = 1;
      s.sunAz[i] = (i * 0.5) % 360; // 0.5 degrees per hour
    }
    return s;
  }
  const mask = {
    azStepDeg: 0.5,
    distKm: { '2': Array.from({ length: 720 }, () => 34) },
  } as unknown as HorizonMask;

  it('finds the Sun direction, distance and length of the spell that breaks the profile', () => {
    const s = series();
    const p = byId('short-stay');
    const ev = evaluate(s, 0, p);
    expect(ev.failures).toContain('dark-gap');
    const ctx = failureContext(s, mask, 2, 0, ev, p);
    expect(ctx.sunAzDeg).toBeCloseTo(24, 0); // Sun azimuth at hour 48
    expect(ctx.sunObstructionKm).toBe(34);
    expect(ctx.darkSpellDays).toBeGreaterThan(1.9);
    expect(ctx.darkSpellDays).toBeLessThan(2.1);
    const v = describeVerdict({ ev, profile: p, slipMarginMs: 0, nextWindowStartMs: null, landingMs: T0, terrain: 'lola-80m+240m', ctx });
    expect(v.text).toContain('34 km away to the north-east');
    expect(v.text).toContain('hidden for 2 days');
    expect(ctx.darkSpellInStayH).toBeGreaterThan(47);
    expect(ctx.darkSpellInStayH).toBeLessThan(49);
    expect(v.text).not.toContain('inside the stay'); // the whole spell is inside the stay
  });
  it('measures how much of a dark spell falls inside the stay when it runs past the end', () => {
    const s = series();
    const p = { ...byId('short-stay'), stayDays: 3 }; // stay ends at hour 72; the spell runs to hour 96
    const ev = evaluate(s, 0, p);
    const ctx = failureContext(s, mask, 2, 0, ev, p);
    expect(ctx.darkSpellDays).toBeGreaterThan(1.9);
    expect(ctx.darkSpellInStayH).toBeGreaterThan(23);
    expect(ctx.darkSpellInStayH).toBeLessThan(25);
    const v = describeVerdict({ ev, profile: p, slipMarginMs: 0, nextWindowStartMs: null, landingMs: T0, terrain: 'lola-80m+240m', ctx });
    expect(v.text).toMatch(/stays hidden for 2 days; 2\d hours of that fall inside the stay/);
  });
  it('reports the Sun at landing when it is down then', () => {
    const s = series();
    const p = byId('short-stay');
    const ev = evaluate(s, 60, p);
    const ctx = failureContext(s, mask, 2, 60, ev, p);
    expect(ev.failures).toContain('sun-down-at-landing');
    expect(ctx.sunReturnsAfterH).toBeCloseTo(35.5, 1);
    expect(ctx.sunObstructionKm).toBe(34);
  });
});

describe('compareSentence', () => {
  const mk = (over: Partial<PlanSummary>): PlanSummary => ({
    siteName: 'Connecting Ridge',
    landingMs: T0,
    ev: okEv,
    slipMarginMs: 3 * DAY,
    profile: byId('lunar-day'),
    ...over,
  });
  const bad: Evaluation = { ...okEv, ok: false, failures: ['dark-gap'], sunShare: 0.8, longestDarkGapH: 48, firstFailureAfterH: 70 };

  it('both work', () => {
    const s = compareSentence(mk({}), mk({ landingMs: T0 + 9 * DAY, slipMarginMs: 1 * DAY }));
    expect(s).toContain('Plan B lands at the same site 9 days after plan A.');
    expect(s).toContain('Plan A can slip up to 3 days and plan B up to 24 hours, so plan A has more room.');
  });
  it('one works, one fails, with the reason and the Sun shares', () => {
    const s = compareSentence(mk({}), mk({ landingMs: T0 + 9 * DAY, ev: bad }));
    expect(s).toContain('Plan A works and plan B fails because the Sun is hidden for 2 days of the stay, longer than this mission profile allows');
    expect(s).toContain('100% of the stay in plan A against 80% in plan B');
  });
  it('the other way round', () => {
    const s = compareSentence(mk({ ev: bad }), mk({ siteName: 'Other' }));
    expect(s).toContain('The plans differ in site');
    expect(s).toContain('Plan B works and plan A fails');
  });
  it('both fail', () => {
    const s = compareSentence(mk({ ev: bad }), mk({ ev: { ...bad, failures: ['earth-share'], earthShare: 0.4 } }));
    expect(s).toContain('Both fail: plan A because the Sun is hidden for 2 days of the stay');
    expect(s).toContain('plan B because Earth is in view for only 40% of the stay');
  });
});
