// Report export (version 2): a self-contained HTML summary of the comparison (verdicts, key
// numbers, the two ribbons as drawn) and a CSV of the hourly data for both stays.

import { DSN_COMPLEXES, DSN_RECEIVE_MIN_EL_DEG } from '../engine/dsn';
import { DEFAULT_POWER, simulatePower } from '../engine/power';
import type { PlanState } from '../state/hooks';

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

function csvRows(label: string, p: PlanState): string[] {
  if (p.status !== 'ready') return [];
  const { series, dsn, site } = p.data;
  const L = p.view.landingIdx, n = Math.max(1, p.view.stayEndIdx - L);
  const run = simulatePower(series, DEFAULT_POWER, L, n);
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const i = L + k;
    const dishes = DSN_COMPLEXES.filter((_, ci) => dsn.moonElDeg[ci][i] >= DSN_RECEIVE_MIN_EL_DEG).map((c) => c.id);
    const contact = series.earthFrac[i] >= 0.5 && dishes.length > 0;
    out.push([
      label, `"${site.name.replace(/"/g, '""')}"`, iso(series.startMs + i * series.stepMs), k,
      series.sunAz[i].toFixed(2), series.sunEl[i].toFixed(3), series.sunHorizon[i].toFixed(3), series.sunFrac[i].toFixed(3),
      series.earthAz[i].toFixed(2), series.earthEl[i].toFixed(3), series.earthHorizon[i].toFixed(3), series.earthFrac[i].toFixed(3),
      (series.sunCover?.[i] ?? 0).toFixed(3), Math.round(run.powerW[k]), Math.round(run.chargeWh[k]), dishes.join(' '), contact ? 1 : 0,
    ].join(','));
  }
  return out;
}

export function exportCsv(planA: PlanState, planB: PlanState, heightM: number) {
  const head = 'plan,site,utc,hours_after_landing,sun_az_deg,sun_el_deg,skyline_at_sun_deg,sun_visible_fraction,earth_az_deg,earth_el_deg,skyline_at_earth_deg,earth_visible_fraction,sun_covered_by_earth,panel_w,battery_wh,dsn_complexes_seeing_moon,contact';
  const note = `# Ribbon export. Observer ${heightM} m above the ground. Panel ${DEFAULT_POWER.areaM2} m2, ${DEFAULT_POWER.efficiency * 100}% efficient, turned to the Sun; battery ${DEFAULT_POWER.batteryWh} Wh; load ${DEFAULT_POWER.loadW} W (this tool's assumptions). DSN limit ${DSN_RECEIVE_MIN_EL_DEG} deg.`;
  const text = [note, head, ...csvRows('A', planA), ...csvRows('B', planB)].join('\n') + '\n';
  const site = planA.status === 'ready' ? planA.data.site.id : 'plan';
  download(`ribbon-${site}-hourly.csv`, 'text/csv', text);
}

export function exportReport(comparison: string | null, planA: PlanState, planB: PlanState, heightM: number, profileLabel: string) {
  const css = getComputedStyle(document.documentElement);
  const vars = ['--sky', '--panel', '--line', '--terrain', '--terrain-edge', '--sun', '--earth', '--dark', '--text', '--text2', '--alert', '--good']
    .map((v) => `${v}:${css.getPropertyValue(v).trim()}`).join(';');
  const section = (label: string, p: PlanState, id: string) => {
    if (p.status !== 'ready') return '';
    const svg = document.querySelector(`#${id} svg[role="img"]`)?.outerHTML ?? '';
    const v = p.view;
    return `<section><h2>${label}: ${esc(p.data.site.name)}</h2>
<p class="meta">Lands ${iso(v.landingMs)} UTC · ${Math.abs(p.data.site.lat).toFixed(4)}° ${p.data.site.lat < 0 ? 'S' : 'N'}, ${p.data.site.lon.toFixed(4)}° · ${esc(v.verdict.source)}</p>
<p class="verdict ${v.verdict.ok ? 'ok' : 'bad'}">${esc(v.verdict.text)}</p>
<div class="svg">${svg}</div></section>`;
  };
  const table = document.querySelector('#key-numbers table')?.outerHTML ?? '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Ribbon report</title>
<style>:root{${vars}}body{background:var(--sky);color:var(--text);font:15px/1.5 system-ui,sans-serif;max-width:1400px;margin:24px auto;padding:0 20px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px}.meta{color:var(--text2);font-size:13px}.verdict.ok{border-left:3px solid var(--good);padding-left:10px}.verdict.bad{border-left:3px solid var(--alert);padding-left:10px}
.svg{overflow-x:auto}table{border-collapse:collapse}td,th{border-bottom:1px solid var(--line);padding:4px 12px;text-align:left}.mono,text{font-family:ui-monospace,monospace}</style></head><body>
<h1>Ribbon: lunar landing-site comparison</h1>
<p class="meta">Exported ${iso(Date.now())} UTC · ${esc(profileLabel)} · observer ${heightM} m above the ground · ${esc(location.href)}</p>
<p>${esc(comparison ?? '')}</p>
${section('Plan A', planA, 'plan-a')}
${section('Plan B', planB, 'plan-b')}
<h2>Key numbers</h2>${table}
<p class="meta">Sun and Earth from astronomy-engine, checked against NASA JPL Horizons; terrain from NASA LOLA. Panel, battery and some thresholds are this tool's assumptions (see the app's notes). Not affiliated with or endorsed by NASA.</p>
</body></html>`;
  const site = planA.status === 'ready' ? planA.data.site.id : 'plan';
  download(`ribbon-${site}-report.html`, 'text/html', html);
}
