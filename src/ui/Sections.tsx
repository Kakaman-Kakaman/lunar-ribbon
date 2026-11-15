// Validation and Data and credits sections.
// Validation renders src/data/validation.json if it exists and is well formed, and nothing otherwise.

interface Check {
  id: string;
  title: string;
  reference: string;
  result: string;
  detail: string;
  status: string;
}

// import.meta.glob returns an empty object when the file is absent, so a missing file cannot break the build.
const found = import.meta.glob('../data/validation.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function readChecks(): Check[] {
  const doc = Object.values(found)[0] as { checks?: unknown } | undefined;
  if (!doc || !Array.isArray(doc.checks)) return [];
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return doc.checks
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      id: str(c.id) || str(c.title),
      title: str(c.title),
      reference: str(c.reference),
      result: str(c.result),
      detail: str(c.detail),
      status: str(c.status),
    }))
    .filter((c) => c.title && c.result);
}

const CHECKS = readChecks();

function StatusMark({ status }: { status: string }) {
  const pass = status === 'pass';
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded border border-line px-2 py-0.5 text-xs font-semibold text-ink">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        {pass ? (
          <>
            <circle cx="7" cy="7" r="6" fill="none" stroke="var(--good)" strokeWidth="1.6" />
            <path d="M4,7.2 L6.1,9.3 L10,4.8" fill="none" stroke="var(--good)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : (
          <>
            <path d="M7,1.5 L13,12.5 H1 Z" fill="none" stroke="var(--sun)" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M7,5.5 V8.6 M7,10.3 V10.4" stroke="var(--sun)" strokeWidth="1.6" strokeLinecap="round" />
          </>
        )}
      </svg>
      {pass ? 'Pass' : 'Note'}
    </span>
  );
}

export function Validation() {
  if (CHECKS.length === 0) return null;
  return (
    <section id="validation" aria-labelledby="val-h" className="rounded-lg border border-line bg-panel p-6">
      <h2 id="val-h" className="text-xl font-semibold">Validation</h2>
      <p className="mt-1 max-w-[90ch] text-ink2">
        How the engine behind the ribbon was checked against NASA references. &quot;Pass&quot; means the result matched within the
        stated tolerance. &quot;Note&quot; means the comparison has a caveat that you should read before relying on it.
      </p>
      <ul className="mt-4 grid grid-cols-2 gap-4">
        {CHECKS.map((c) => (
          <li key={c.id} className="rounded-md border border-line bg-sky p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[15px] font-semibold leading-snug text-ink">{c.title}</h3>
              <StatusMark status={c.status} />
            </div>
            {c.reference && <p className="mt-1 text-xs text-ink2">Reference: {c.reference}</p>}
            <p className="mt-2 text-[14px] leading-snug text-ink">{c.result}</p>
            {c.detail && (
              <details className="mt-2 text-[13px] text-ink2">
                <summary className="cursor-pointer text-ink hover:underline">Details</summary>
                <p className="mt-1.5 leading-snug">{c.detail}</p>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Credits() {
  return (
    <section id="credits" aria-labelledby="cred-h" className="rounded-lg border border-line bg-panel p-6">
      <h2 id="cred-h" className="text-xl font-semibold">Data and credits</h2>
      <div className="mt-4 grid grid-cols-3 gap-6 text-[14px] leading-snug">
        <div>
          <h3 className="mb-1.5 font-semibold text-ink">Data</h3>
          <ul className="space-y-2 text-ink2">
            <li>
              <span className="text-ink">NASA Goddard 2023 south-pole elevation model (terrain).</span> LDEM_80S_20MPP_ADJ, 20 m
              per pixel, from NASA Goddard&apos;s Planetary Geodesy Data Archive. The terrain near every south-pole site.
            </li>
            <li>
              <span className="text-ink">NASA LOLA (terrain).</span> Lunar Orbiter Laser Altimeter gridded data records: 240 m
              (south), 10 m, 20 m, 80 m and 240 m (north), and 480 m for typed points. Neumann, G. A. (2011), LRO Moon Laser
              Altimeter 4 GDR V1.0, NASA Planetary Data System, doi:10.17189/1520642.
            </li>
            <li>
              <span className="text-ink">NASA Deep Space Network.</span> Antenna positions and the elevation limit from the DSN
              Telecommunications Link Design Handbook, 810-005, module 301.
            </li>
            <li>
              <span className="text-ink">NASA Earth Fact Sheet.</span> Solar irradiance at 1 AU (1361 W/m²), for panel power.
            </li>
            <li>
              <span className="text-ink">NASA JPL Horizons (check).</span> Reference tables for the Sun and Earth directions the
              engine computes. NASA/JPL Solar System Dynamics, Horizons System, data retrieved 14 November 2026. Horizons cannot
              be called from a browser, so the app does not use it live.
            </li>
            <li>
              <span className="text-ink">NASA Moon Trek and NASA Goddard sunlight maps (check).</span> Ground heights and
              Goddard&apos;s average Sun and Earth visibility maps (method of Mazarico et al. 2011, Icarus 211), read through Moon
              Trek, are what the terrain and skylines were checked against.
            </li>
            <li>
              <span className="text-ink">ACT Artemis III Geotechnical maps (check).</span> Malapert Massif Sun and Earth
              visibility cubes, LROC QuickMap, used for the date-by-date check.
            </li>
            <li>
              <span className="text-ink">Sites.</span> The five NASA Goddard study sites come from the Planetary Geodesy Data
              Archive; north-pole craters from the IAU Gazetteer of Planetary Nomenclature. Every other site carries its own
              source in the project&apos;s site catalogue.
            </li>
            <li>
              <span className="text-ink">When the Sun counts as up.</span> At least half the disc above the skyline, the
              convention of ESA&apos;s lunar lander site study (De Rosa et al. 2012, Planetary and Space Science 74).
            </li>
          </ul>
        </div>
        <div>
          <h3 className="mb-1.5 font-semibold text-ink">Software</h3>
          <ul className="space-y-1 text-ink2">
            <li>astronomy-engine (MIT): positions of the Sun, Earth and Moon</li>
            <li>React (MIT)</li>
            <li>Tailwind CSS (MIT)</li>
            <li>Vite (MIT)</li>
            <li>TypeScript (Apache-2.0)</li>
            <li>Vitest (MIT)</li>
            <li>three.js (MIT): the 3D view</li>
            <li>geotiff.js (MIT): reading the 2023 elevation model</li>
          </ul>
          <p className="mt-2 text-ink2">Versions and licences are in CREDITS.md in the project repository.</p>
        </div>
        <div>
          <h3 className="mb-1.5 font-semibold text-ink">Notes</h3>
          <p className="text-ink2">
            Everything drawn comes from the data above; the 3D lighting is computed, not photographed. This tool is not affiliated with or endorsed by NASA.
          </p>
          <p className="mt-2 text-ink2">
            Times are UTC. A body counts as up when at least half of its disc is above the skyline. The reference surface is a
            sphere of radius 1737.4 km.
          </p>
        </div>
      </div>
    </section>
  );
}
