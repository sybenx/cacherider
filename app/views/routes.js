// Two lists: every Connect route, and the campus shuttle's routes with what's out.
import { D } from '../data.js';
import { html, icon, badge } from '../ui.js';
import { U, chip, live, hasData, hours, notice, offNote } from '../usu.js';

export function render({ which }, clockNow) {
  const back = html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Home</a></div>`;
  if (which === 'usu') {
    if (!U) return { html: html`${back}<div class="empty"><h2>Shuttle data isn't loaded</h2></div>`, title: 'Aggie Shuttle' };
    const rows = U.routes.map((r, ri) => ({ r, ri })).filter(x => x.r.stops.length).map(({ r, ri }) => {
      const n = live.buses.filter(b => b.ri === ri).length;
      return html`<a class="row" href="#/usu/route/${r.id}">${chip(ri, 36)}<div class="mid"><span class="name">${r.name}</span><span class="sub">${r.stops.length} stops · ${hasData() ? (n ? n + (n === 1 ? ' bus' : ' buses') + ' on the road' : 'no bus on the road') : 'finding buses…'}${hours(ri) ? ' · ' + hours(ri) : ''}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`;
    });
    return { html: html`${back}<div class="head"><span class="eyebrow">${U.agency || 'Utah State University'}</span><h1>Aggie Shuttle</h1><div class="muted" style="font-size:14px">${U.stops.length} stops on campus · live, no timetable</div></div>${notice()}<div class="list">${rows}</div>${offNote()}<div class="fine">Positions come straight from USU's shuttle tracker; minutes are estimated from where each bus is. Search any campus stop by name.</div>`, title: 'Aggie Shuttle', live: true, keepScroll: true };
  }
  const rows = D.routes.map((r, i) => html`<a class="row" href="#/route/${encodeURIComponent(r.short)}">${badge(i, 36)}<div class="mid"><span class="name">${r.long}</span>${r.desc ? html`<span class="sub">${r.desc.replace(/,\s*/g, ' · ')}</span>` : ''}</div><span class="muted">${icon('fwd', 20)}</span></a>`);
  return { html: html`${back}<div class="head"><span class="eyebrow">${D.agency.name}</span><h1>${D.agency.brand}</h1><div class="muted" style="font-size:14px">${D.routes.length} routes · scheduled, zero fare</div></div><div class="list">${rows}</div><div class="fine">Times come from ${D.agency.brand}'s published schedule, refreshed nightly. Every route meets at the ${D.hub.name}.</div>`, title: D.agency.brand };
}
