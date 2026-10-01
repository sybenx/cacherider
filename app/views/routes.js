// Every route, a row each: Connect's, then the Aggie Shuttle's loops. Where does this bus go, for a rider who doesn't
// know its number yet. Back from the archive (it went 2026-09-24 with the systems panel; a grid of chips replaced it,
// then search did): on a phone there was no way to see the routes but typing 'routes'.
import { D } from '../data.js';
import { html, icon, badge, routeName } from '../ui.js';
import { U, chip, live, hasData, hours, notice, offNote } from '../usu.js';

export function render(_, clockNow) {
  const back = html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Stops</a></div>`;
  const desc = r => (r.desc || '').replace(/^.*? - /, '').replace(/,\s*/g, ' · ');
  const rows = D.routes.map((r, i) => html`<a class="row" href="#/map/route/${encodeURIComponent(r.short)}">${badge(i, 36)}<div class="mid"><span class="name">${routeName(i, false)}</span>${desc(r) ? html`<span class="sub">${desc(r)}</span>` : ''}</div><span class="muted">${icon('fwd', 20)}</span></a>`);
  const shuttle = U ? U.routes.map((r, ri) => ({ r, ri })).filter(x => x.r.stops.length).map(({ r, ri }) => {
    const n = live.buses.filter(b => b.ri === ri).length;
    return html`<a class="row" href="#/usu/route/${r.id}">${chip(ri, 36)}<div class="mid"><span class="name">${r.name}</span><span class="sub">${r.stops.length} stops · ${hasData() ? (n ? n + (n === 1 ? ' bus' : ' buses') + ' out' : 'no bus out') : 'finding buses…'}${hours(ri) ? ' · ' + hours(ri) : ''}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`;
  }) : [];
  return {
    html: html`${back}<div class="head"><span class="eyebrow">${D.agency.name}</span><h1>Routes</h1><div class="muted" style="font-size:14px">${D.routes.length} ${D.agency.brand} routes · every one meets at the ${D.hub.name}</div></div>
      <div class="list">${rows}</div>
      ${shuttle.length ? html`<div class="section">${icon('route', 16)}Aggie Shuttle</div>${notice()}<div class="list">${shuttle}</div>${offNote()}` : ''}
      <div class="fine">Times come from ${D.agency.brand}'s published schedule, refreshed nightly; the shuttle's from USU's tracker, live.</div>`,
    title: 'Routes', live: !!U, keepScroll: true,
  };
}
