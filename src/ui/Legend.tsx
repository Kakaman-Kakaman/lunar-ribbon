// Legend for the ribbon. One legend serves both plans because both use the same layers.

import type { ReactNode } from 'react';

function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg width="34" height="16" viewBox="0 0 34 16" aria-hidden="true" className="shrink-0">
      {children}
    </svg>
  );
}

function Item({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {icon}
      <span>{children}</span>
    </li>
  );
}

export function Legend() {
  return (
    <section aria-label="Legend" className="rounded-lg border border-line bg-panel px-5 py-4">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink">Legend</h2>
      <ul className="grid grid-cols-3 gap-x-6 gap-y-2 text-[13px] text-ink2">
        <Item icon={<Swatch><rect x="1" y="3" width="32" height="10" fill="var(--sun)" fillOpacity="0.25" /></Swatch>}>
          Sun band: where the Sun&apos;s centre goes over the whole period shown, widened by the Sun&apos;s radius
        </Item>
        <Item icon={<Swatch><rect x="1" y="3" width="32" height="10" fill="var(--earth)" fillOpacity="0.32" /></Swatch>}>
          Earth region: where Earth&apos;s centre wobbles over the same period
        </Item>
        <Item icon={<Swatch><path d="M1,8 H33" stroke="var(--sun)" strokeWidth="2" /></Swatch>}>
          Sun path over the stay (solid: Sun is up; fainter beyond the stay)
        </Item>
        <Item icon={<Swatch><path d="M1,8 H33" stroke="var(--sun)" strokeWidth="1.4" strokeDasharray="1.5 4" strokeLinecap="round" opacity="0.7" /></Swatch>}>
          Sun path dotted: the Sun is hidden by terrain (mostly behind the terrain shape)
        </Item>
        <Item icon={<Swatch><path d="M1,8 H33" stroke="var(--sun)" strokeWidth="2" opacity="0.55" /></Swatch>}>
          Sun path faint: terrain hides part of the Sun, so the panels get less light
        </Item>
        <Item icon={<Swatch><path d="M1,8 H33" stroke="var(--earth)" strokeWidth="1" /></Swatch>}>
          Earth path over the same period
        </Item>
        <Item icon={<Swatch><path d="M1,12 L8,8 L15,10 L22,4 L33,7 L33,15 L1,15 Z" fill="var(--terrain)" /><path d="M1,12 L8,8 L15,10 L22,4 L33,7" fill="none" stroke="var(--terrain-edge)" strokeWidth="1.4" /></Swatch>}>
          Terrain skyline: opaque, so anything behind it is hidden
        </Item>
        <Item icon={<Swatch><path d="M1,10 L8,6 L15,8 L22,2 L33,5 L33,9 L22,7 L15,12 L8,10 L1,13 Z" fill="var(--terrain-edge)" fillOpacity="0.28" /><path d="M1,11 L8,8 L15,10 L22,4 L33,7" fill="none" stroke="var(--terrain-edge)" strokeWidth="1.4" /></Swatch>}>
          Pale strip along the skyline: how much it changes if the site lies anywhere within its position uncertainty
        </Item>
        <Item icon={<Swatch><rect x="1" y="2" width="32" height="13" fill="var(--terrain)" /><path d="M3,6 H14 M18,9 H31" stroke="var(--terrain-edge)" opacity="0.6" /><path d="M5,12 H26" stroke="var(--terrain-edge)" opacity="0.2" /></Swatch>}>
          Lines inside the terrain: ridges in front of the skyline; brighter means nearer
        </Item>
        <Item icon={<Swatch><defs><pattern id="lg-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--dark)" /><line x1="0" y1="0" x2="0" y2="7" stroke="var(--text2)" strokeWidth="1.4" opacity="0.7" /></pattern></defs><rect x="1" y="2" width="32" height="12" fill="url(#lg-hatch)" stroke="var(--text2)" /></Swatch>}>
          Dark span: terrain hides the Sun; the label is how long it lasts
        </Item>
        <Item icon={<Swatch>{Array.from({ length: 8 }, (_, k) => <line key={k} x1="17" y1="3.5" x2="17" y2="1" stroke="var(--sun)" strokeWidth="1.5" transform={`rotate(${k * 45} 17 8)`} />)}<circle cx="17" cy="8" r="4.5" fill="var(--sun)" /></Swatch>}>
          Sun marker at the time cursor. A hollow dashed circle means hidden. Symbols, not to scale
        </Item>
        <Item icon={<Swatch><circle cx="17" cy="8" r="5" fill="var(--earth)" /><ellipse cx="17" cy="8" rx="5" ry="2" fill="none" stroke="var(--sky)" /><line x1="17" y1="3" x2="17" y2="13" stroke="var(--sky)" /></Swatch>}>
          Earth marker at the time cursor. A symbol, not to scale
        </Item>
      </ul>
      <p className="mt-3 text-[13px] text-ink2">
        Day numbers along the Sun path count days after landing. The Sun moves along the strip in the direction of the
        arrowhead on its path, about half a day after landing.
      </p>
    </section>
  );
}
