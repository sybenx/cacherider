// The stop page, by time: what's next, then the rest of the day. Its states:
// after the last bus, no service today, and a stop nothing calls at today.
import { D, stopIndex, stop, nextAt, today, newTimetable, nextServiceDay, remember, distance, servicesOn, isSaved, toggleSaved, stopAlerts, closedRoutes } from '../data.js';
import { relative, fmtDay, dayName, clockText, metres, dayFrom } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, depRow, headsign, side, stopTitle } from '../ui.js';
import { U, chips, liveTag } from '../usu.js';
import { miniSlot, mountMini } from './mini.js';
import { metres as m2 } from '../time.js';

export function render({ id, full }, clockNow) {
  const si = stopIndex(id);
  if (si === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2><p>Stop ${id} isn't in the current timetable.</p></div>`, title: 'Stop' };
  const s = stop(si);
  remember(s.id);
  const parts = [];
  const sv = isSaved(s.id);
  parts.push(html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Stops</a>
    <button class="btn btn-ghost save" id="save" aria-pressed="${sv ? 'true' : 'false'}" data-id="${s.id}">${icon('star', 22, 1.5, sv ? 'currentColor' : 'none')}${sv ? 'Saved' : 'Save'}</button></div>`);
  parts.push(miniSlot({ stopId: s.id }));
  const sd = side(si);
  const eyebrow = sd ? `${s.town} · ${sd} side` : `${s.town} · Stop ${s.code || s.id}`;
  parts.push(html`<div class="head"><span class="eyebrow">${eyebrow}</span><h1>${s.name}</h1>${badges(s.routes, 30, true)}</div>`);

  if (s.twin) {
    const [ti, td] = s.twin;
    const t = stop(ti);
    const n = nextAt(ti, 1, clockNow)[0];
    const tsd = side(ti);
    parts.push(html`<a class="twin blueprint" href="#/stop/${t.id}">${corners()}<span style="color:var(--color-accent-700)">${icon('swap', 22)}</span>
      <div class="mid"><span class="eyebrow">Across the road · ${metres(td)}</span><span class="name">${t.name}${tsd ? ' · ' + tsd : ''}</span>
      ${n ? html`<div class="when">${badge(n.r, 20)}${time(n.min, 17)}<span class="rel">${relative(n, clockNow)}</span>${sched()}</div>` : html`<span class="rel">No service today</span>`}</div>
      <span class="muted">${icon('fwd', 20)}</span></a>`);
  }

  const sh = U && U.sharedByCvtd[si];
  if (sh) {
    const us = U.stops[sh.i];
    parts.push(html`<a class="twin blueprint" href="#/usu/${us.id}">${corners()}<span style="color:var(--color-accent-700)">${icon('hub', 22)}</span>
      <div class="mid"><span class="eyebrow">USU shuttle · ${m2(sh.d)}</span><span class="name">${us.name}</span><div class="when">${chips(us.routes, 20)}${liveTag()}</div></div>
      <span class="muted">${icon('fwd', 20)}</span></a>`);
  }
  const nt = newTimetable(clockNow);
  const td = today(si, clockNow);
  const next = nextAt(si, 7, clockNow);

  // Detours that name this stop: which routes are skipping it, in the agency's words.
  const alerts = stopAlerts(si, clockNow.ymd);
  const closed = closedRoutes(si, clockNow.ymd);
  const allClosed = closed.size && s.routes.every(ri => closed.has(ri));
  if (alerts.length) {
    const who = [...closed].map(ri => 'Route ' + D.routes[ri].short).join(' and ');
    const head = allClosed ? 'No buses stop here during the detour' : closed.size ? `${who} ${closed.size > 1 ? 'skip' : 'skips'} this stop right now` : 'Service alert for this stop';
    parts.push(html`<div class="callout alert">${icon('ban', 20)}<div><b>${head}</b>${alerts.map(a => html`<div class="sub"><b>${a.title}</b>${a.text}${a.url ? html` <a href="${a.url}" target="_blank" rel="noopener">More</a>` : ''}</div>`)}</div></div>`);
  }

  if (allClosed) {
    // Nothing to schedule here; the callout above has said why.
  } else if (!td.systemRuns) {
    const resume = nextServiceDay(clockNow);
    parts.push(html`<div class="callout">${icon('moon', 20)}<div><b>No buses today</b><div class="sub">${D.agency.brand} doesn't run on ${dayName(clockNow.ymd)}s. ${resume ? `Service resumes ${fmtDay(resume, true)}${nt && nt <= resume ? ', on the new timetable' : ''}.` : ''}</div></div></div>`);
  } else if (!td.all.length) {
    const only = s.routes.map(ri => D.routes[ri]);
    const weekdayOnly = only.filter(r => !servicesOnDays(r)).length;
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>No ${dayName(clockNow.ymd)} service at this stop</b><div class="sub">${only.length === 1 ? `Route ${only[0].short} ${describeDays(only[0])}.` : 'The routes here ' + (weekdayOnly ? 'run weekdays only' : 'skip today') + '.'} Other routes are running today.</div></div></div>`);
  } else if (!td.left.length && td.last) {
    parts.push(html`<div class="callout">${icon('moon', 20)}<div><b>Last bus today left at ${clockText(td.last.min)}</b><div class="sub">The next one is ${next[0] && next[0].day === 1 ? 'tomorrow morning' : next[0] ? dayName(next[0].ymd) : 'not in the timetable'}.</div></div></div>`);
  } else if (nt) {
    parts.push(html`<div class="notice">${icon('calendar', 16)}<span>New timetable starts <b>${fmtDay(nt)}</b></span></div>`);
  }

  const prov = [...new Set(td.all.filter(t => t.prov).map(t => t.r))];
  if (prov.length) {
    const sid = td.all.find(t => t.prov).prov;
    const from = D.services.find(x => x.id === sid);
    const names = prov.map(ri => 'Route ' + D.routes[ri].short).join(' and ');
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>${names} ${prov.length > 1 ? 'are' : 'is'} missing from this week's published timetable</b><div class="sub">Times shown are from the one starting ${from ? fmtDay(from.start) : 'soon'}. The bus is running; check a detour.</div></div></div>`);
  }
  if (!next.length) {
    parts.push(allClosed ? html`<div class="empty"><h2>Nothing scheduled</h2><p>Departures return when the detour ends.</p></div>` : html`<div class="empty"><h2>Nothing scheduled</h2><p>No departures from this stop in the next week.</p></div>`);
    return { html: parts.join(''), title: s.name, mount, keepScroll: true };
  }

  const first = next[0];
  const dayWord = first.day === 0 ? '' : first.day === 1 ? 'tomorrow, ' + dayName(first.ymd, true) : dayName(first.ymd);
  parts.push(html`<div class="next"><div class="top"><span class="eyebrow">Next bus</span>${sched()}</div>
    <div class="big">${time(first.min, 60)}<span class="rel">${first.day === 0 ? relative(first, clockNow) : dayWord}</span></div>
    <div class="who">${badge(first.r, 32)}<span>${headsign(first)}</span></div></div>`);

  if (full) {
    // The whole day, past departures muted, grouped by day if we had to roll over.
    const all = td.all.length ? td.all.map(t => ({ ...t, day: 0, ymd: clockNow.ymd })) : nextAt(si, 200, clockNow, 8).filter(t => t.day === next[0].day);
    const label = all[0].day === 0 ? fmtDay(clockNow.ymd, true) : fmtDay(all[0].ymd, true);
    parts.push(html`<div class="dayhead">${label} · ${all.length} departures</div>`);
    parts.push(html`<div class="list">${all.map(t => html.raw(`<div style="${t.day === 0 && t.min < clockNow.min ? 'opacity:.45' : ''}">${depRow(t, clockNow, { rel: t.day === 0 && t.min < clockNow.min ? 'gone' : relative(t, clockNow) }).s}</div>`))}</div>`);
    parts.push(html`<div style="padding:12px 16px"><a class="btn btn-secondary btn-block" style="min-height:48px" href="#/stop/${s.id}">What's next</a></div>`);
    return { html: parts.join(''), title: s.name, mount, keepScroll: true };
  }

  const rest = next.slice(1);
  let lastDay = first.day;
  const rows = [];
  for (const t of rest) {
    if (t.day !== lastDay) { rows.push(html`<div class="dayhead">${fmtDay(t.ymd, true)}</div>`); lastDay = t.day; }
    rows.push(depRow(t, clockNow, { dayShort: true }));
  }
  if (first.day !== 0 && rows.length && !String(rows[0]).startsWith('<div class="dayhead"')) rows.unshift(html`<div class="dayhead">${fmtDay(first.ymd, true)}</div>`);
  parts.push(html`<div class="list">${html.raw(rows.join(''))}</div>`);
  const todayCount = td.all.length;
  if (todayCount) parts.push(html`<div style="padding:12px 16px"><a class="btn btn-secondary btn-block" style="min-height:48px" href="#/stop/${s.id}/all">Full day · ${todayCount} departures</a></div>`);
  return { html: parts.join(''), title: s.name, mount, keepScroll: true };
}

function servicesOnDays(r) { return true; }
function describeDays(r) {
  // Which days a route runs at all: from the services its departures carry.
  const days = new Set();
  for (const per of Object.values(D.times)) for (const [sid, list] of Object.entries(per)) if (list.some(t => t[1] === D.routes.indexOf(r))) days.add(sid);
  const svc = D.services.filter(s => days.has(s.id));
  const weekday = svc.some(s => s.days.slice(0, 5).some(Boolean)), sat = svc.some(s => s.days[5]), sun = svc.some(s => s.days[6]);
  if (weekday && !sat && !sun) return 'runs weekdays only';
  if (!weekday && sat) return 'runs Saturdays only';
  return 'is not running today';
}

function mount(el) {
  mountMini(el);
  const b = el.querySelector('#save');
  if (!b) return;
  b.onclick = () => {
    const on = toggleSaved(b.dataset.id);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = icon('star', 22, 1.5, on ? 'currentColor' : 'none').s + (on ? 'Saved' : 'Save');
  };
}
