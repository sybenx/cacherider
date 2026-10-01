// The stop page, by time: what's next, then the rest of the day. Its states:
// after the last bus, no service today, and a stop nothing calls at today.
import { D, stopIndex, stop, nextAt, timed, today, newTimetable, timesChange, nextServiceDay, remember, isSaved, toggleSaved, stopAlerts, closedRoutes, dayAlert, quietWords, dayShape, alertsUntil, poolAt, POOL, A, distance, skipsAt, passesAt, lastBuses } from '../data.js';
import { relative, fmtDay, dayName, clockText, dayFrom } from '../time.js';
import { routeNames, routeName, html, icon, badge, time, sched, corners, depRow, cancelledRow, routeLinks, headsign, side, liveMark, liveWord, lively, when, wasLine, loopArrival, minsOut, lastTag, acrossRow } from '../ui.js';
import { cancelledAt } from '../rt.js';
import { shareButton, siteLink } from '../share.js';
import { U, chips, liveTag } from '../usu.js';
import { metres as m2 } from '../time.js';
import { afterSave, app } from '../main.js';
import { restOfDay, runSheet, wireSheet, sheetRun } from './stopwide.js';
import { wirePointers, pointerDial } from '../pointer.js';
import { atPath, walkMins } from '../geo.js';

export function render({ id, full, run, on }, clockNow) {
  const si = stopIndex(id);
  if (si === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2><p>Stop ${id} isn't in the current timetable.</p></div>`, title: 'Stop' };
  const s = stop(si);
  remember(s.id);
  const parts = [];
  const sv = isSaved(s.id);
  parts.push(html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Stops</a>
    ${shareButton({ url: siteLink('stop/' + s.id), title: s.name, lines: [`Stop ${s.code || s.id}${s.town && s.town !== 'Logan' ? ' · ' + s.town : ''}`, 'Its next buses, live when they report'] })}
    <button class="btn btn-ghost save" id="save" aria-pressed="${sv ? 'true' : 'false'}" data-id="${s.id}">${icon('star', 22, 1.5, sv ? 'currentColor' : 'none')}${sv ? 'Saved' : 'Save'}</button></div>`);
  const sd = side(si);
  const eyebrow = `${s.town} · Stop ${s.code || s.id}${sd ? ` · ${sd} side` : ''}${s.by ? ` · ${s.by}` : ''}`;   // the number stays: it's what a rider quotes on the phone; the landmark is what the bus announces
  const g = app.geo;   // how far and which way, turning with the phone, whenever there's a fix
  // Across the road, the stop for the other way and the commonest wrong one to stand at: a pill of its own under the
  // routes, room enough to say where that side's next bus is going.
  parts.push(html`<div class="head"><span class="eyebrow">${eyebrow}</span><h1>${s.name}</h1>${routeLinks(si)}<div class="golinks"><a class="golink" href="#/go/${s.id}">${icon('route', 16)}How to get here</a><a class="golink" href="#/go/-/${atPath({ lat: s.lat, lon: s.lon, label: s.name })}">${icon('fwd', 16)}From here</a></div>${tpLine(si)}${s.twin ? acrossRow(si, clockNow) : ''}</div>`);
  if (g) parts.push(html.raw(pointerDial(s.lat, s.lon, g, s.name)));   // the compass: which way and how far, turning with the phone

  const aside = [];   // the shuttle stop on the same pole
  const sh = U && U.sharedByCvtd[si];
  if (sh) {
    const us = U.stops[sh.i];
    aside.push(html`<a class="twin blueprint" href="#/usu/${us.id}">${corners()}<span style="color:var(--color-accent-700)">${icon('hub', 22)}</span>
      <div class="mid"><span class="eyebrow">USU shuttle · ${m2(sh.d)}</span><span class="name">${us.name}</span><div class="when">${chips(us.routes, 20)}${liveTag()}</div></div>
      <span class="muted">${icon('fwd', 20)}</span></a>`);
  }
  parts.push(...aside);
  const nt0 = newTimetable(clockNow);
  const nt = nt0 && timesChange(si, nt0) ? nt0 : null;   // said only where this stop's times change
  const td = today(si, clockNow);
  const next = nextAt(si, 7, clockNow);

  // Detours that name this stop: which routes are skipping it, in the agency's words.
  const alerts = stopAlerts(si, clockNow.ymd);
  const closed = closedRoutes(si, clockNow.ymd);
  const allClosed = closed.size && s.routes.every(ri => closed.has(ri));
  // Where its buses stop instead, seen from them on their way round (announced or not): the nearest such stop.
  const instead = list => {
    const alt = list.flatMap(u => u.on.map(id => ({ u, t: D.stops[stopIndex(id)] }))).map(x => ({ ...x, d: distance(s.lat, s.lon, x.t.lat, x.t.lon) })).sort((x, y) => x.d - y.d)[0];
    return alt ? html`<div class="sub">${routeNames(alt.u.ri)} buses came past <a href="#/stop/${alt.t.id}">${alt.t.name}</a> (stop ${alt.t.code}) on their way round, a ${walkMins(s.lat, s.lon, alt.t.lat, alt.t.lon)} min walk from here.</div>` : '';
  };
  // A way the bus calls here only when asked (16 northbound at Pepperidge Farms): said once, with the number to ask.
  const req = nextAt(si, 60, clockNow).find(t => t.req);
  if (req) parts.push(html`<div class="notice">${icon('info', 16)}<span>${headsign(req)}, the bus stops here only on request: pull the cord to get off, or call <a href="tel:${D.agency.phone}">${D.agency.phone}</a> ahead to be picked up.</span></div>`);
  if (dayAlert(clockNow.ymd)) parts.push(html`<div class="notice">${icon('info', 16)}<span>Service changes today · <a href="#/about/alerts">see alert</a></span></div>`);
  // A bus stop that is also a POOL pickup: the on-demand ride goes from here too.
  if (poolAt(si)) parts.push(html`<div class="notice">${icon('info', 16)}<span>Also a <b>POOL</b> pickup: ${D.agency.brand}'s on-demand ride around ${POOL.towns.slice(0, 3).join(', ')}, zero fare, booked in the On-Demand app or on <a href="tel:${POOL.phone}">${POOL.phone}</a>. <a href="${POOL.url}" target="_blank" rel="noopener">How it works</a></span></div>`);
  if (alerts.length) {
    const who = routeNames([...closed]);
    // When it ends: the alert's day, and no hour (an alert 'ending Wednesday' ends some time that day, the feed's end
    // its last minute). 'Until Tue 29 Sep' read as back that morning, and 'today' on the day as closed all of it.
    // On the day it stays closed here (a walk to a stop that's served, not a wait at one that may be skipped).
    const end = alertsUntil(alerts), onEnd = end === clockNow.ymd;
    const ends = end && !onEnd ? ' · the detour ends ' + (end === dayFrom(clockNow.ymd, 1).ymd ? 'tomorrow' : fmtDay(end)) : '';
    const head = allClosed ? (onEnd ? 'No buses stop here until the detour ends, later today' : `No buses stop here${ends || ' during the detour'}`)
      : closed.size ? `${who} ${closed.size > 1 ? 'skip' : 'skips'} this stop${onEnd ? ' until the detour ends, later today' : ends || ' right now'}` : 'Service alert for this stop';
    parts.push(html`<div class="callout alert">${icon('ban', 20)}<div><b class="${closed.size ? 'warnmark' : ''}">${head}</b>${instead((A.seen || []).filter(u => u.gone.includes(s.id)))}${alerts.map(a => html`<div class="sub"><b>${a.title}</b>${a.text}${a.url ? html` <a href="${a.url}" target="_blank" rel="noopener">More</a>` : ''}</div>`)}</div></div>`);
  }

  // Unannounced detours, apart from the agency's notices and never in their red: a question, what it rests on, where
  // to wait instead, and that it's ours. Nothing dropped from the times.
  const fine = html`<div class="fine">Unannounced: seen from ${D.agency.brand}'s buses, not posted by ${D.agency.brand}.</div>`;
  const qbadge = u => html`<span class="qbadge" style="--rc:#${D.routes[u.ri[0]].color};--rt:#${D.routes[u.ri[0]].text}">?</span>`;
  for (const u of skipsAt(s.id).filter(u => !u.ri.every(ri => closed.has(ri)))) {
    parts.push(html`<div class="callout unann">${qbadge(u)}<div><b>${lastBuses(u)} ${u.n >= 4 ? 'has' : 'have'} skipped this stop</b><div class="sub">${u.n >= 4 ? 'They have gone' : 'They went'} around it${u.by.length ? ' by ' + u.by.join(' and ') : ''}, the latest at ${u.last}.</div>${instead([u])}${fine}</div></div>`);
  }
  for (const u of passesAt(s.id)) {
    const names = u.gone.map(id => D.stops[stopIndex(id)].name);
    parts.push(html`<div class="callout unann">${qbadge(u)}<div><b>${lastBuses(u)} came past this stop</b><div class="sub">On their way around ${names.length === 1 ? names[0] : names.length + ' of their usual stops: ' + names.join(', ')}.</div>${fine}</div></div>`);
  }

  if (allClosed) {
    // Nothing to schedule here; the callout above has said why.
  } else if (!td.systemRuns) {
    const resume = nextServiceDay(clockNow);
    parts.push(html`<div class="callout">${icon('moon', 20)}<div><b>No buses today</b><div class="sub">${D.agency.brand} doesn't run on ${dayName(clockNow.ymd)}s. ${resume ? `Service resumes ${fmtDay(resume, true)}${nt && nt <= resume ? ', on the new timetable' : ''}.` : ''}</div></div></div>`);
  } else if (!td.all.length) {
    const only = s.routes.map(ri => D.routes[ri]);
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>No ${dayName(clockNow.ymd)} service at this stop</b><div class="sub">${only.length === 1 ? `Route ${only[0].short} ${describeDays(only[0])}.` : 'The routes here skip today.'} Other routes are running today.</div></div></div>`);
  } else if (!td.left.length && td.last && !(next[0] && next[0].day === 0)) {   // a late last bus is still coming
    parts.push(html`<div class="callout">${icon('moon', 20)}<div><b>Last bus today left at ${clockText(td.last.min)}</b><div class="sub">The next one is ${next[0] ? (next[0].day === 1 ? 'tomorrow' : dayName(next[0].ymd)) + ' at ' + clockText(next[0].min) : 'not in the timetable'}.</div></div></div>`);
  } else if (nt) {
    parts.push(html`<div class="notice">${icon('calendar', 16)}<span>New timetable starts <b>${fmtDay(nt)}</b></span></div>`);
  }

  // A Saturday runs shorter and thinner than a weekday: say how, up front, for riders who know the weekday times.
  if (dayFrom(clockNow.ymd).dow === 6 && td.all.length) parts.push(html`<div class="notice">${icon('calendar', 16)}<span>Saturday service today: <b>${dayShape(si, clockNow.ymd)}</b></span></div>`);
  const prov = [...new Set(td.all.filter(t => t.prov).map(t => t.r))];
  if (prov.length) {
    const sid = td.all.find(t => t.prov).prov;
    const from = D.services.find(x => x.id === sid);
    const names = routeNames(prov);
    parts.push(html`<div class="callout">${icon('info', 20)}<div><b>${names} ${prov.length > 1 ? 'are' : 'is'} missing from this week's published timetable</b><div class="sub">Times shown are from the one starting ${from ? fmtDay(from.start) : 'soon'}. The bus is running; check a detour.</div></div></div>`);
  }
  if (!next.length) {
    parts.push(allClosed ? html`<div class="empty"><h2>Nothing scheduled</h2><p>Departures return when the detour ends.</p></div>` : html`<div class="empty"><h2>Nothing scheduled</h2><p>No departures from this stop in the next week.</p></div>`);
    return { html: parts.join(''), title: s.name, mount, keepScroll: true };
  }

  const first = next[0];
  // Runs the feed says are cancelled, today in the next two hours: before the next bus, said above it (the one a rider
  // came for may be one); after it, struck in the list in their place. They'd been a gap, the list jumping past them.
  const cx = cancelledAt(si, clockNow, 120);
  const cxBefore = cx.filter(t => first.day > 0 || t.min < first.min);
  if (cxBefore.length) parts.push(html`<div class="notice cancelnotice">${icon('ban', 16)}<span><b>Cancelled:</b> ${cxBefore.map(t => routeName(t.r, false) + ' at ' + clockText(t.min)).join(', ')}</span></div>`);
  const dayWord0 = first.day === 0 ? '' : first.day === 1 ? 'tomorrow, ' + dayName(first.ymd, true) : dayName(first.ymd);
  // A detour closing this stop pushes the next bus to after it ends, days off: say so, in the warning yellow.
  // Across a day without buses (Saturday evening to Monday): 'Monday · no buses Sunday', lest it read as tomorrow.
  const quiet = first.day > 1 ? quietWords(clockNow.ymd, first.ymd) : '';
  const dayWord = dayWord0 && closed.has(first.r) ? html`<span class="warnmark">${dayWord0} · after the detour</span>`
    : quiet ? html`${dayWord0} · <b class="quiet">${quiet}</b>` : dayWord0;
  parts.push(html`<div class="next"${first.trip !== undefined ? html.raw(` data-trip="${first.trip}" data-on="${first.ymd}"`) : ''}><div class="top"><span class="eyebrow">Next bus</span>${first.live ? liveMark(liveWord(first)) : sched(first)}</div>
    ${wasLine(first)}<div class="big">${loopArrival(first) ? minsOut(first, 60, clockNow) : html`${time(first.min, 60, !!first.live)}<span class="rel">${first.day === 0 ? relative(first, clockNow) : dayWord}</span>`}</div>
    <div class="who">${badge(first.r, 32)}<span>${headsign(first)}</span></div>${lastTag(first)}</div>`);



  // Today's buses here all gone: the whole day to show is the next day with buses, not a list of ones already run.
  const todayAll = td.all.map(t => lively({ ...t, day: 0, ymd: clockNow.ymd }));
  const doneToday = !todayAll.some(t => !t.gone && t.min >= clockNow.min);
  const nextDay = doneToday && next[0] && next[0].day > 0 ? nextAt(si, 200, clockNow, 8).filter(t => t.day === next[0].day) : null;
  if (full) {
    // The whole day by the timetable, past departures muted, grouped by day if we had to roll over. Past is the feed's
    // word where it has one: a late bus whose minute has gone by is still coming.
    const all = nextDay || todayAll;
    const past = t => t.day === 0 && (t.gone || t.min < clockNow.min);
    const label = all[0].day === 0 ? fmtDay(clockNow.ymd, true) : fmtDay(all[0].ymd, true);
    parts.push(html`<div class="dayhead">${label} · ${all.length} departures${alertLink(all[0].ymd)}</div>`);
    parts.push(html`<div class="list">${all.map(t => html.raw(t.cancelled && t.min >= clockNow.min ? cancelledRow(t).s : `<div style="${past(t) ? 'opacity:.45' : ''}">${depRow(t, clockNow, { rel: past(t) ? 'gone' : relative(t, clockNow) }).s}</div>`))}</div>`);
    parts.push(html`<div style="padding:12px 16px"><a class="btn btn-secondary btn-block" style="min-height:48px" href="#/stop/${s.id}">What's next</a></div>`);
    return { html: parts.join(''), title: s.name, mount, keepScroll: true };
  }

  const rest = next.slice(1);
  let lastDay = first.day, lastYmd = first.ymd;
  const rows = [];
  const cxAfter = cx.filter(t => !cxBefore.includes(t));
  for (const t of rest) {
    while (cxAfter.length && t.day === 0 && cxAfter[0].min <= t.min) rows.push(cancelledRow(cxAfter.shift()).s);
    if (t.day !== 0 && cxAfter.length) rows.push(...cxAfter.splice(0).map(c => cancelledRow(c).s));
    if (t.day !== lastDay) {
      // Tonight's last bus here, then the next day's: a clear break, lest a Monday time read as later tonight.
      if (lastDay === 0) rows.push(html`<div class="endservice"><span>End of service today</span></div>`.s);
      rows.push(dayHead(si, t.ymd, lastYmd)); lastDay = t.day; lastYmd = t.ymd;
    }
    const row = depRow(t, clockNow, { dayShort: true, warn: t.day > 0 && closed.has(t.r) }).s;   // days off because of the detour
    rows.push(t.trip !== undefined ? `<div class="runopen" data-trip="${t.trip}" data-on="${t.ymd}">${row}</div>` : row);
  }
  if (first.day !== 0 && rows.length && !String(rows[0]).startsWith('<div class="dayhead"')) rows.unshift(dayHead(si, first.ymd, clockNow.ymd));
  parts.push(html`<div class="list">${html.raw(rows.join(''))}</div>`);
  // The day an hour to a column, its times each a way into their run: in a sheet over the page, with an address of
  // its own (?run=trip&on=day), so Back closes it.
  const pick = run !== undefined && run !== '' ? { trip: +run } : { trip: null };
  parts.push(restOfDay(si, next, clockNow, pick));
  // The run is drawn on the map itself: beside the panel on a wide screen, above the sheet on a phone or a tablet.
  const sheet = pick.trip !== null ? runSheet(si, next, clockNow, pick.trip, on || clockNow.ymd) : null;
  return { html: html`<div class="phone-stop" data-stop="${s.id}">${html.raw(parts.join(''))}</div>`, title: s.name, mount, keepScroll: true, sheet, run: sheet ? sheetRun() : null };
}

/** A timed stop for some of its routes (a timepoint): which, and what it means for a rider waiting. */
function tpLine(si) {
  const ris = stop(si).routes.filter(ri => timed(si, ri));
  if (!ris.length) return '';
  return html`<span class="tpline">${icon('clock', 14)}<span>A timed stop for ${routeNames(ris).replace(/^Route/, 'route')}: an early bus waits here for its time.</span></span>`;
}
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

/** A run opened from the page: its sheet, reached by a step in the history (Back closes it); another run from the
 *  sheet replaces that step, so one Back still closes it. */
let pushedRun = false;
function mount(el) {
  wirePointers(el, app);
  const page = el.querySelector('.phone-stop');
  if (page) {
    const at = (trip, on) => `#/stop/${page.dataset.stop}?run=${trip}&on=${on}`;
    page.onclick = e => {
      const b = e.target.closest('[data-trip]');
      if (!b || e.target.closest('a, button:not([data-trip])')) return;
      pushedRun = true;
      location.hash = at(b.dataset.trip, b.dataset.on);
    };
    wireSheet(document.getElementById('runsheet'), {
      swap: (trip, on) => location.replace(at(trip, on)),
      close: () => { if (pushedRun) { pushedRun = false; history.back(); } else location.replace(`#/stop/${page.dataset.stop}`); },
    });
  }
  const b = el.querySelector('#save');
  if (!b) return;
  b.onclick = () => {
    const on = toggleSaved(b.dataset.id);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = icon('star', 22, 1.5, on ? 'currentColor' : 'none').s + (on ? 'Saved' : 'Save');
    if (on) afterSave();
  };
}

/** A day's heading in a stop's list: the date, any days without buses before it, a Saturday's shorter, thinner
 *  service ('12:00–6:30 PM, hourly'), and a system alert about the day. */
function dayHead(si, ymd, prevYmd) {
  const quiet = quietWords(prevYmd, ymd), sat = dayFrom(ymd).dow === 6 ? dayShape(si, ymd) : '';
  return html`<div class="dayhead">${fmtDay(ymd, true)}${quiet ? html` · <span class="quiet">${quiet}</span>` : ''}${sat ? html` · <span class="shape">${sat}</span>` : ''}${alertLink(ymd)}</div>`;
}

/** On a day a system-wide alert is about (a parade, a late start), the day's heading says its times may not hold:
 *  the alert's words can't be read into the timetable, so the rider is sent to them. */
function alertLink(ymd) {
  return dayAlert(ymd) ? html` · <a class="dayalert" href="#/about/alerts">Service changes · see alert</a>` : '';
}
