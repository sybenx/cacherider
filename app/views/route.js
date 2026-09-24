// A route: its stops in order, each with the route's next call there.
import { D, route, stop, nextAt } from '../data.js';
import { relative, clockText } from '../time.js';
import { html, icon, badge, badges, time, sched, stopRow } from '../ui.js';

export function render({ short, dir }, clockNow) {
  const ri = D.routeByShort[short];
  if (ri === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such route</h2></div>`, title: 'Route' };
  const r = route(ri);
  const dirs = Object.keys(r.stops || {});
  const d = dirs.includes(dir) ? dir : dirs[0];
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Stops</a></div>`];
  parts.push(html`<div class="head"><span class="eyebrow">Route</span><div style="display:flex;align-items:center;gap:12px">${badge(ri, 44)}<div><h1 style="font-size:30px">${r.long}</h1>${r.desc ? html`<div class="muted" style="font-size:14px">${r.desc.replace(/,\s*/g, ' · ')}</div>` : ''}</div></div></div>`);
  if (dirs.length > 1) {
    parts.push(html`<div class="chips">${dirs.map(k => html`<a class="chip" href="#/route/${encodeURIComponent(short)}/${k}" ${k === d ? html.raw('style="border-color:var(--color-accent);color:var(--color-accent-700)"') : ''}>${r.dirs[+k] || (k === '0' ? 'Outbound' : 'Return')}</a>`)}</div>`);
  }
  const seq = (r.stops || {})[d] || [];
  const rows = seq.map(si => {
    const n = nextAt(si, 1, clockNow, 8, t => t.r === ri)[0];
    return stopRow(si, n, clockNow, { none: 'Not today' });
  });
  parts.push(html`<div class="section">${icon('stops', 16)}${seq.length} stops, in order</div><div class="list">${rows}</div>`);
  return { html: parts.join(''), title: 'Route ' + r.short };
}
