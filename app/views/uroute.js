// A shuttle route: its stops in loop order, each with the nearest bus.
import { html, icon } from '../ui.js';
import { U, estimate, chip, liveTag, isStale, hasData, lastSeen, live, notice } from '../usu.js';

export function render({ id }) {
  const ri = U ? U.routeById[id] : undefined;
  if (ri === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such route</h2></div>`, title: 'Shuttle' };
  const r = U.routes[ri];
  const buses = live.buses.filter(b => b.ri === ri);
  const parts = [html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Stops</a></div>`];
  parts.push(html`<div class="head"><span class="eyebrow">${U.name}</span><div style="display:flex;align-items:center;gap:12px">${chip(ri, 44)}<div><h1 style="font-size:30px">${r.name}</h1><div class="muted" style="font-size:14px">${r.stops.length} stops · ${hasData() ? (buses.length ? buses.length + (buses.length === 1 ? ' bus' : ' buses') + ' on the road' : 'no bus on the road right now') : 'finding buses…'}</div></div></div></div>`);
  parts.push(notice());
  const rows = r.stops.map(si => {
    const s = U.stops[si], e = hasData() ? estimate(si, ri) : null;
    const end = e ? `<div class="end"><span class="t t-22">${e.here ? 'Here' : e.stops === null ? e.min + ' min' : e.stops + (e.stops === 1 ? ' stop' : ' stops')}</span><span class="rel">${isStale() ? 'at ' + lastSeen() : 'about ' + e.min + ' min'}</span></div>` : `<div class="end"><span class="rel">${hasData() ? '—' : ''}</span></div>`;
    return html.raw(`<a class="row" href="#/usu/${s.id}"><span class="usq" style="background:${r.color}"></span><div class="mid"><span class="name">${s.name}</span>${e ? liveTag(isStale() ? 'Last seen ' + lastSeen() : 'Live').s : ''}</div>${end}</a>`);
  });
  parts.push(html`<div class="list">${rows}</div>`);
  return { html: parts.join(''), title: r.name, live: true, keepScroll: true };
}
