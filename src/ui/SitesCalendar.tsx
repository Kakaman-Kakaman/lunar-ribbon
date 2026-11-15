// Sites by landing dates (version 2): every site with real terrain against every landing day of the
// scanned year, under the current rules and observer height. A cell is brighter green the more of
// that day's four 6-hour landing slots work; failing days are tinted by the first rule they break.
// Computed on request, one site after another in the series worker. Clicking a cell loads that
// site and day as plan B.

import { useEffect, useRef, useState } from 'react';
import type { MissionProfile } from '../engine/mission';
import { fmtDateUtc } from '../engine/verdict';
import { getSeries } from '../state/compute';
import { scanFor } from '../state/plan';
import { loadMask, type SiteInfo } from '../state/sites';
import { useWidth } from './hooks';

const LABEL_W = 250;
const ROW_H = 15;
const DAY = 86400000;

interface Row {
  site: SiteInfo;
  startMs: number;
  /** Per day: number of working slots (0-4) and the OR of the failure codes. */
  ok: Uint8Array;
  code: Uint8Array;
}

interface Props {
  sites: SiteInfo[];
  heightM: number;
  anchorMs: number;
  profile: MissionProfile;
  onPick(siteId: string, ms: number): void;
}

export function SitesCalendar({ sites, heightM, anchorMs, profile, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [forKey, setForKey] = useState('');
  const [hover, setHover] = useState<{ r: number; d: number } | null>(null);
  const terrainSites = sites.filter((s) => s.terrain !== 'smooth-sphere' && s.lat <= -60);
  const key = `${heightM}|${anchorMs}|${profile.id}|${profile.stayDays}|${profile.maxDarkGapHours}|${profile.minEarthShare}|${profile.minBatteryCharge}|${profile.minContactHoursPerDay}`;
  const stale = rows.length > 0 && forKey !== key;

  async function run() {
    setBusy(true);
    setRows([]);
    setForKey(key);
    const out: Row[] = [];
    for (const site of terrainSites) {
      try {
        const mask = await loadMask(site);
        const r = await getSeries(mask, heightM, anchorMs);
        const scan = scanFor(r.series, profile, r.dsn);
        const days = Math.floor(scan.n / 4);
        const ok = new Uint8Array(days), code = new Uint8Array(days);
        for (let d = 0; d < days; d++) for (let k = 0; k < 4; k++) {
          const c = scan.code[d * 4 + k];
          if (c === 0) ok[d]++; else code[d] |= c;
        }
        out.push({ site, startMs: scan.startMs, ok, code });
        setRows([...out]);
      } catch {
        // A site that fails to load is left out; the others still show.
      }
    }
    setBusy(false);
  }

  const days = rows[0]?.ok.length ?? 0;
  const plotW = Math.max(200, width - LABEL_W - 8);
  const cw = days ? plotW / days : 1;
  const H = rows.length * ROW_H + 22;

  useEffect(() => {
    const c = canvas.current;
    if (!c || !rows.length) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round((LABEL_W + plotW) * dpr);
    c.height = Math.round(H * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const tok = (n: string) => css.getPropertyValue(n).trim();
    g.clearRect(0, 0, LABEL_W + plotW, H);
    g.font = '12px ' + tok('--font-sans');
    rows.forEach((row, ri) => {
      const y = ri * ROW_H;
      g.fillStyle = tok('--text2');
      g.textBaseline = 'middle';
      const name = row.site.name.length > 38 ? row.site.name.slice(0, 37) + '…' : row.site.name;
      g.fillText(name, 0, y + ROW_H / 2);
      for (let d = 0; d < row.ok.length; d++) {
        const x = LABEL_W + d * cw;
        const n = row.ok[d];
        if (n > 0) { g.globalAlpha = 0.3 + (0.7 * n) / 4; g.fillStyle = tok('--good'); }
        else {
          const c = row.code[d];
          g.fillStyle = c & 1 ? tok('--sun') : c & 2 ? tok('--earth') : tok('--text2');
          g.globalAlpha = 0.28;
        }
        g.fillRect(x, y + 1, Math.max(1, cw - 0.3), ROW_H - 2);
      }
      g.globalAlpha = 1;
    });
    // month ticks
    g.fillStyle = tok('--text2');
    g.font = '11px ' + tok('--font-mono');
    const start = rows[0].startMs;
    for (let d = 0; d < days; d++) {
      const t = new Date(start + d * DAY);
      if (t.getUTCDate() === 1) {
        g.fillRect(LABEL_W + d * cw, rows.length * ROW_H, 1, 4);
        g.fillText(t.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }) + (t.getUTCMonth() === 0 ? ` ${t.getUTCFullYear()}` : ''), LABEL_W + d * cw + 2, rows.length * ROW_H + 12);
      }
    }
  }, [rows, plotW, cw, H, days]);

  const at = (e: React.MouseEvent) => {
    const r = canvas.current?.getBoundingClientRect();
    if (!r || !days) return null;
    const ri = Math.floor((e.clientY - r.top) / ROW_H), d = Math.floor((e.clientX - r.left - LABEL_W) / cw);
    return ri >= 0 && ri < rows.length && d >= 0 && d < days ? { r: ri, d } : null;
  };
  const why = (c: number) => [c & 1 ? 'Sun' : '', c & 2 ? 'Earth' : '', c & 4 ? 'battery or contact' : ''].filter(Boolean).join(', ');
  const hoverText = hover && rows[hover.r] ? (() => {
    const row = rows[hover.r];
    const n = row.ok[hover.d];
    return `${row.site.name}, ${fmtDateUtc(row.startMs + hover.d * DAY)}: ${n === 0 ? `no landing slot works (fails on ${why(row.code[hover.d])})` : `${n} of 4 landing slots work`}. Click to load as plan B.`;
  })() : ' ';

  return (
    <section aria-labelledby="cal-h" className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="cal-h" className="text-base font-semibold">Every site, every landing day</h2>
        <button type="button" onClick={run} disabled={busy} className="rounded-md border border-[#454b57] px-3 py-1 text-sm hover:border-ink2 disabled:opacity-50">
          {busy ? `Computing ${rows.length} of ${terrainSites.length} sites...` : rows.length ? (stale ? 'Settings changed: recompute' : 'Recompute') : `Compute for all ${terrainSites.length} sites`}
        </button>
      </div>
      <p className="mb-2 text-xs text-ink2">
        The sites with real terrain, against each landing day of the year scanned for plan A, under the current mission profile and observer height. Brighter green: more of the day&apos;s four 6-hour landing slots work. Tinted cells fail: amber on the Sun, blue on Earth, grey on battery or contact.
      </p>
      <div ref={box}>
        {rows.length > 0 && (
          <>
            <p className="mono min-h-[1.25rem] text-xs text-ink" aria-live="polite">{hoverText}</p>
            <canvas
              ref={canvas} style={{ width: LABEL_W + plotW, height: H, display: 'block', cursor: 'pointer' }}
              role="img" aria-label={`Landing days that work at ${rows.length} sites`}
              onPointerMove={(e) => setHover(at(e))} onPointerLeave={() => setHover(null)}
              onClick={(e) => { const h = at(e); if (h) onPick(rows[h.r].site.id, rows[h.r].startMs + h.d * DAY + 12 * 3600000); }}
            />
          </>
        )}
      </div>
    </section>
  );
}
