// Replay a real landing: loads the mission's site and landing time as plan A, with plan B the same
// site three days later. Each caption keeps what the app computes apart from what happened, and
// every fact in it is checked (docs/PLAN.md section 6, research/05, src/data/validation.json).

import type { ScenarioApi } from '../state/hooks';
import { withPreset } from '../state/scenario';

interface Mission {
  key: string;
  label: string;
  site: string;
  /** Landing time rounded to the hour: the app works in whole hours. */
  landingMs: number;
  landed: string;
  happened: string;
  check: string | null;
  limit: string;
}

const MISSIONS: Mission[] = [
  {
    key: 'im1',
    label: 'IM-1 Odysseus',
    site: 'im-1-odysseus',
    landingMs: Date.UTC(2024, 1, 22, 23),
    landed: 'Landed 22 February 2024 at about 23:23 UTC at 80.13° S, 1.44° E. Shown here at 23:00.',
    happened: 'It came down on a 12° slope inside a worn crater about a kilometre across (NASA) and tipped over.',
    check: 'With no terrain our engine sets the Sun on 3 March 2024 at 08:11 UTC, in line with NASA JPL Horizons. The real skyline hides it earlier, as the verdict below shows.',
    limit: 'The strip shows the skyline of the site, not the tilted lander or where its panels faced.',
  },
  {
    key: 'im2',
    label: 'IM-2 Athena',
    site: 'im-2-athena',
    landingMs: Date.UTC(2025, 2, 6, 17),
    landed: 'Landed 6 March 2025 at about 17:28 UTC at 84.79° S, 29.20° E. Shown here at 17:00.',
    happened: 'It came to rest on its side in a small crater about 250 m from its target, and surface operations lasted under 13 hours.',
    check: null,
    limit: 'An 80 m grid cannot see a crater that small, so the strip shows the site around it, not the view from inside.',
  },
  {
    key: 'bg1',
    label: 'Blue Ghost Mission 1',
    site: 'blue-ghost-m1',
    landingMs: Date.UTC(2025, 2, 2, 9),
    landed: 'Landed 2 March 2025 at 08:34 UTC in Mare Crisium, 18.56° N, 61.81° E. Shown here at 09:00.',
    happened: 'Firefly reported 346 hours of operations in daylight; the lander then ran about five more hours into the night.',
    check: 'From the actual landing time our engine puts sunset 347.8 hours later.',
    limit: 'The app has no terrain this far from the pole, so the skyline is a smooth sphere, and the Sun climbs high: the strip reads as an ordinary Sun path.',
  },
];

export function Replays({ api }: { api: ScenarioApi }) {
  const { s } = api;
  const active = MISSIONS.find((m) => s.siteA === m.site && s.landingMs === m.landingMs);
  const load = (m: Mission) =>
    api.replace({ ...withPreset(s, 'lunar-day'), siteA: m.site, siteB: m.site, landingMs: m.landingMs, bMode: 'plus', bPlusDays: 3, bOwnMs: m.landingMs + 3 * 86400000 });

  return (
    <section aria-label="Real landings" className="rounded-lg border border-line bg-panel px-4 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-ink2">Replay a real landing:</span>
        {MISSIONS.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={active?.key === m.key}
            onClick={() => load(m)}
            className={`rounded-md border px-2.5 py-1 ${active?.key === m.key ? 'border-ink text-ink' : 'border-[#454b57] text-ink hover:border-ink2'}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {active && (
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 leading-snug" aria-live="polite">
          <span className="text-ink2">Landing</span>
          <span className="text-ink">{active.landed} Plan B is the same site three days later, for comparison.</span>
          <span className="text-ink2">What happened</span>
          <span className="text-ink">{active.happened}</span>
          {active.check && (
            <>
              <span className="text-ink2">Our check</span>
              <span className="text-ink">{active.check}</span>
            </>
          )}
          <span className="text-ink2">Limit</span>
          <span className="text-ink">{active.limit}</span>
        </div>
      )}
    </section>
  );
}
