// Every route, a row each: Connect's, then the Aggie Shuttle's loops. Where does this bus go, for a rider who doesn't
// know its number yet. Back from the archive (it went 2026-09-24 with the systems panel; a grid of chips replaced it,
// then search did): on a phone there was no way to see the routes but typing 'routes'.
import { D, opOf, roadOf, dayPart } from '../data.js';
import { html, icon, badge, routeName, routeList, routeHref } from '../ui.js';
import { U, chip, live, hasData, hours, notice, offNote } from '../usu.js';

export function render(_, clockNow) {
  const back = html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.state&&history.state.prev){history.back();return false}">${icon('back', 22)}Stops</a></div>`;
  const desc = r => (r.desc || '').replace(/^.*? - /, '').replace(/,\s*/g, ' · ');
  // Another operator's route on one of Connect's roads, under it: its run there, whose bus it is ('Midday run by
  // Pocatello Regional Transit · free', under Route 16).
  const sub = (r, i) => opOf(i) && roadOf(i) !== null ? [dayPart(i) ? dayPart(i).replace(/^./, c => c.toUpperCase()) + ' run by ' + opOf(i).name : opOf(i).name, opOf(i).fare && /^free/i.test(opOf(i).fare) ? 'free' : ''].filter(Boolean).join(' · ') : desc(r);
  const row = i => { const r = D.routes[i], s = sub(r, i); return html`<a class="row" href="${routeHref(i)}">${badge(i, 36)}<div class="mid"><span class="name">${routeName(i, false)}</span>${s ? html`<span class="sub">${s}</span>` : ''}</div><span class="muted">${icon('fwd', 20)}</span></a>`; };
  // Route 16 one row (16 AM and PM, one route), the Preston commuter's after it; an operator's on no road of Connect's
  // under its name.
  const { list, others: alone } = routeList();
  const rows = list.map(row), count = list.filter(i => !opOf(i)).length;
  const ops = [...new Set(alone.map(i => opOf(i).name))];
  const others = ops.map(name => html`<div class="section">${icon('route', 16)}${name}</div><div class="list">${alone.filter(i => opOf(i).name === name).map(row)}</div>`);
  const shuttle = U ? U.routes.map((r, ri) => ({ r, ri })).filter(x => x.r.stops.length).map(({ r, ri }) => {
    const n = live.buses.filter(b => b.ri === ri).length;
    return html`<a class="row" href="#/usu/route/${r.id}">${chip(ri, 36)}<div class="mid"><span class="name">${r.name}</span><span class="sub">${r.stops.length} stops · ${hasData() ? (n ? n + (n === 1 ? ' bus' : ' buses') + ' out' : 'no bus out') : 'finding buses…'}${hours(ri) ? ' · ' + hours(ri) : ''}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`;
  }) : [];
  return {
    html: html`${back}<div class="head"><span class="eyebrow">${D.agency.name}</span><h1>Routes</h1><div class="muted" style="font-size:14px">${count} ${D.agency.brand} routes · every one meets at the ${D.hub.name}</div></div>
      <div class="list">${rows}</div>${others}
      ${shuttle.length ? html`<div class="section">${icon('route', 16)}Aggie Shuttle</div>${notice()}<div class="list">${shuttle}</div>${offNote()}` : ''}
      <div class="fine">Times come from ${D.agency.brand}'s published schedule, refreshed nightly${D.routes.filter(r => r.op).map(r => `; the ${r.long}'s from ${r.op.short || r.op.name}'s timetable`).join('')}; the shuttle's from USU's tracker, live.</div>`,
    title: 'Routes', live: !!U, keepScroll: true,
  };
}
