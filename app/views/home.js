// Home, the watchface on the phone: one answer set large, when the next bus
// leaves your stop. A saved stop takes the hero; without one, the nearest
// stop; without location, the Transit Center pulse, with both systems and one
// ask for location beneath it. Search lives on its own page.
import { D, nextAt, nextPulse, nextServiceDay, timesOn, newTimetable, recent, saved, setSaved, search, nearest, stop, distance, systemAlerts, activeAlerts, quietWords } from '../data.js';
import { relative, fmtDay, metres, clock, clockText, dayName } from '../time.js';
import { routeName, routeNames, html, icon, badge, badges, time, sched, corners, stopRow, side, esc, headsign, liveMark, liveWord, when, wasLine, loopArrival, lastTag, fillLater, moved } from '../ui.js';
import { nearMe, nearOff, installCard, wireInstall } from '../main.js';
import { pointerMark, wirePointers } from '../pointer.js';
import { U, stopRowU, chip, live, shuttleWords, offHours, isStale } from '../usu.js';
import { results, pickOf, forPick } from './find.js';
import { byWalk, spotOf, spotKey } from '../geo.js';
import { isWide } from '../wide.js';

export function render({ q, page, pick, from }, clockNow) {
  const app = window.__app;
  if (page === 'search' || q) return searchPage(q, clockNow, app, pickOf(pick, from));
  return landing(clockNow, app);
}

// ---- the landing
function landing(clockNow, app) {
  if (app) window.__app = app;   // the hero's pointer reads the fix from it
  const sv = saved();
  const firstSaved = sv.find(id => !id.startsWith('u:') && D.stopById[id] !== undefined);
  // The big one: the stop you're standing near, when location is on and it's close enough to walk to; else your
  // first saved stop; else the Transit Center. Saved stops are the list beneath, every one but the hero.
  // Past the Transit Center's bays, a dozen stops at one address: standing there, the nearest is still a street's stop.
  const near = app && app.geo ? byWalk(nearest(app.geo.lat, app.geo.lon, 24).filter(x => !stop(x.i).hub), app.geo.lat, app.geo.lon)[0] : null;   // the quickest walk, the climb counted
  let heroSi, heroWhy = '';
  if (near && near.d <= 800) { heroSi = near.i; heroWhy = 'Nearest'; }
  else if (firstSaved !== undefined) { heroSi = D.stopById[firstSaved]; heroWhy = 'Saved'; }
  else if (near) { heroSi = near.i; heroWhy = 'Nearest'; }
  const stopHero = heroSi !== undefined;
  const geo = app && app.geo;
  const [dow, date, mon] = fmtDay(clockNow.ymd).split(' ');
  const parts = [html`<div class="land-top m-only"><span class="wordmark">Cache Rider</span><span class="land-right"><span class="land-date">${dow} <span class="muted">${mon} ${date}</span></span>
    <button class="btn btn-ghost btn-icon" id="near" type="button" aria-label="${geo ? 'Location on · turn off' : 'Sort stops by distance'}" aria-pressed="${geo ? 'true' : 'false'}" title="${geo ? 'Location on' : 'Near me'}">${icon('near', 22)}</button>
</span></div>`];   // the page's own box is the way in to search, always there: one search, not two
  for (const a of systemAlerts(clockNow.ymd)) parts.push(html`<div class="callout alert land-alert">${icon('info', 20)}<div><b>${a.title}</b><div class="sub">${a.text}</div></div></div>`);

  // What the page answers, in the order a rider asks it (the question list): the next bus from their stop (nearest, or
  // saved), and the stops beside it; then where to (search, directions); then the Center, whose own tab has the rest;
  // then what's broken today. Without a stop yet, the ways to one come first, and the Center is a line, not the page:
  // its big countdown was the Transit Center tab's answer twice, to a first visitor who's seldom there.
  if (stopHero) parts.push(stopHeroBlock(heroSi, heroWhy, clockNow));

  const heroId = stopHero ? stop(heroSi).id : null;
  const others = sv.filter(id => id !== heroId);
  if (others.length || (sv.length && app && app.editSaved)) {
    // Only when there's something beneath: one saved stop is the big one above, star and all.
    const editing = app && app.editSaved;
    parts.push(html`<div class="land-eye"><span class="savedmark">${icon('star', 13, 1.5, 'currentColor')}Saved</span><button class="btn btn-ghost edit" id="edit-saved">${editing ? 'Done' : 'Edit'}</button></div>`);
    if (editing) parts.push(html`<div class="list">${html.raw(sv.map((id, i) => editRow(id, i, sv.length)).join(''))}</div>`);
    else if (others.length) parts.push(html`<div class="list">${others.map(id => id.startsWith('u:') ? (U && U.stopById[id.slice(2)] !== undefined ? stopRowU(U.stopById[id.slice(2)]) : '') : stopRow(D.stopById[id], nextAt(D.stopById[id], 1, clockNow)[0], clockNow))}</div>`);
  }
  if (geo) {   // the stops near you, under whatever is saved: a saved stop across town mustn't hide the one you're standing at
    const rows = byWalk(nearest(geo.lat, geo.lon, 24).filter(x => x.i !== heroSi && !stop(x.i).hub && !sv.includes(stop(x.i).id)), geo.lat, geo.lon).slice(0, 3);
    if (rows.length) parts.push(html`<div class="land-eye"><span>${heroWhy === 'Nearest' ? 'Also near you' : 'Nearest to you'}</span></div><div class="list">${rows.map(({ i, d }) => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { point: geo }))}</div>`);
  }
  // Where to: the box on the page whichever way it opened (a stop's rider got an icon in the header, the question
  // three of the list a tap harder to find). Beside a wide screen's map, the top bar's box is this one.
  const first = !stopHero && !geo;
  // A first visit: what the app is, in a line, before the ways in (a search box and a location button said nothing of it).
  if (first) parts.push(html`<p class="land-purpose">See when the next bus comes to your stop, Connect or the Aggie Shuttle.</p>`);
  parts.push(html`<div class="ask${first ? '' : ' land-where'}">
    <form class="search" id="search" role="search"><input class="input" type="search" placeholder="${first ? 'Street, place or route' : 'Where to?'}" autocomplete="off" aria-label="Search stops, places and routes"><span class="lead">${icon('search', 22)}</span></form>
    ${first ? html`<button class="btn btn-primary btn-lg blueprint" id="near-ask" type="button">${corners()}${icon('near', 20)}Show the stops near me</button>
      <span class="ask-note">Location stays on this device, used only to sort stops.</span>` : ''}</div>`);
  parts.push(hubLine(clockNow), shuttleLine(clockNow));
  // And what the app does, shown rather than said: the busiest stops, by the day's departures, with their next buses.
  // A newcomer may find their own there; either way the page isn't half empty on a first visit.
  if (first) { const busy = busiest(clockNow); if (busy.length) parts.push(html`<div class="land-eye"><span>Busiest stops today</span></div><div class="list">${busy.map(i => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow))}</div>`); }
  if (isWide()) parts.push(chips());   // beside the map, every route a tap away: the page has the room, and the map lights it
  const nt = newTimetable(clockNow);
  if (nt) parts.push(html`<div class="notice">${icon('calendar', 16)}<span>New timetable starts <b>${fmtDay(nt)}</b></span></div>`);
  const detours = activeAlerts(clockNow.ymd).filter(a => (a.stops || []).length || (a.routes || []).length);
  if (detours.length) {
    const rs = [...new Set(detours.flatMap(a => a.ri || []))];
    parts.push(html`<div class="notice">${icon('ban', 16)}<span><b>${detours.length} ${detours.length === 1 ? 'detour' : 'detours'}</b>${rs.length ? ' on ' + routeNames(rs).replace(/^Route/, 'route') : ''} · <a href="#/about/alerts">details</a></span></div>`);
  }
  if (sv.length) parts.push(installCard());   // the offer waits until a rider has saved a stop: proof it's their app
  parts.push(html`<div class="fine">Unofficial. Made by a rider, not by ${D.agency.brand}. Times come from ${D.agency.brand}'s published schedule, refreshed nightly. <a href="#/about">About this app</a></div>`);
  return { html: html`<div class="land">${html.raw(parts.join(''))}</div>`.s, mount, title: '' };
}

/** Every route as a chip: Connect's badges, then the shuttle's in their own colours. Each lights its route on the map. */
function chips() {
  const connect = D.routes.map((r, i) => html`<a href="#/map/route/${encodeURIComponent(r.short)}" aria-label="${routeName(i, false)}">${badge(i, 36)}</a>`);
  const campus = U ? U.routes.map((r, ri) => r.stops.length ? html`<a href="#/usu/route/${r.id}" aria-label="${r.name}">${chip(ri, 36)}</a>` : '') : [];
  return html`<div class="land-eye"><span>Routes</span></div><div class="routes">${connect}</div>${campus.some(Boolean) ? html`<div class="land-eye"><span>Aggie Shuttle</span></div><div class="routes campus">${campus}</div>` : ''}`;
}

/** The giant time: hours, the two accent squares of the colon, minutes, and AM or PM small. */
function giant(min, est = false) {
  const c = clock(min), [hh, mm] = c.h.split(':');
  return html`<div class="giant${est ? ' est' : ''}${hh.length > 1 && c.ap ? ' long' : ''}" aria-label="${clockText(min)}"><span>${hh}</span><span class="colon"><i></i><i></i></span><span>${mm}</span>${c.ap ? html`<span class="ap">${c.ap}</span>` : ''}</div>`;   // AM or PM, lest Monday's 6:30 read as tonight's
}

function stopHeroBlock(si, why, clockNow) {
  const s = stop(si);
  const next = nextAt(si, 3, clockNow);
  // How far and which way, whenever there's a fix (it costs nothing: the phone's compass and the following
  // of the rider's steps only start on a tap). The arrow points as on a north-up map until then.
  const g = window.__app && window.__app.geo;
  const mine = saved().includes(s.id);   // a saved stop keeps its star, nearest or not
  const way = g ? html`${html.raw(pointerMark(s.lat, s.lon, g, true))} · ` : '';
  const eye = html`<div class="eye"><span class="eyebrow${mine ? ' savedmark' : ''}">${mine ? icon('star', 12, 1.5, 'currentColor') : ''}${why} · ${way}Stop ${s.code || s.id}</span>${next[0] && next[0].live ? liveMark(liveWord(next[0])) : sched(next[0])}</div>`;
  if (!next.length) {
    const resume = nextServiceDay(clockNow);
    return html`<div class="hero">${eye}<a class="hero-main" href="#/stop/${s.id}"><span class="stopname">${s.name}</span><div class="hero-none">Nothing scheduled${resume && resume !== clockNow.ymd ? html`<span class="sub">Buses resume ${fmtDay(resume, true)}</span>` : ''}</div></a></div>`;
  }
  const first = next[0];
  const left = first.day === 0 ? first.min - clockNow.min : null;
  const arrival = loopArrival(first);   // a loop spacing its buses: minutes out, never a clock time
  const countdown = left !== null && (left <= 10 || arrival);
  const big = countdown
    ? html`<div class="giant count${first.live ? ' est' : ''}"><span>${left <= 0 ? 'NOW' : left}</span>${left > 0 ? html`<span class="unit">MIN</span>` : ''}</div>`
    : giant(first.min, !!first.live);
  // Moved by the feed, the timetable's time stands crossed out, labelled, above the estimate's side.
  const val = arrival ? '' : countdown ? time(first.min, 34, !!first.live) : first.day === 0 ? html`<span class="rt">${relative(first, clockNow)}</span>` : '';
  const sideVal = val && moved(first) ? html`<span class="side">${wasLine(first)}${val}</span>` : val;
  const quiet = first.day > 1 ? quietWords(clockNow.ymd, first.ymd) : '';   // 'Monday · no buses Sunday'
  const dayWord = first.day === 0 ? '' : first.day === 1 ? 'Tomorrow' : dayName(first.ymd) + (quiet ? ' · ' + quiet : '');
  const then = next.slice(1, 2);   // one, so a moved time and its estimate have room
  const dest = String(headsign(first)), long = D.routes[first.r].long;
  return html`<div class="hero">${eye}<a class="hero-main" href="#/stop/${s.id}"><span class="stopname">${s.name}</span>${big}
    <div class="who">${badge(first.r, 44)}<div class="mid"><span class="dest">${html.raw(dest)}</span>${dayWord || dest.replace(/<[^>]+>/g, '') !== long ? html`<span class="sub">${[dayWord, dest.replace(/<[^>]+>/g, '') !== long ? long : ''].filter(Boolean).join(' · ')}</span>` : ''}${lastTag(first)}</div>${sideVal}</div>
    ${then.length ? html`<div class="then"><span class="eyebrow muted">Then</span>${then.map(t => html`<span class="t t-26">${when(t, 26)}${t.day !== first.day ? html`<small class="day">${t.day === 1 ? 'tomorrow' : dayName(t.ymd, true)}</small>` : ''}</span>`)}</div>` : ''}</a></div>`;
}

/** The stops with the most departures on the day (from the timetable, nothing picked by hand): not the Center's bays,
 *  which have their line, and each at least 800 m from those before it, so they're places across the town and not
 *  one stretch of Main Street three times over (a pair across the road goes with it). Worked out once a day. */
let busyFor = null, busyList = [];
function busiest(clockNow, n = 4) {
  if (busyFor === clockNow.ymd) return busyList;
  const counts = D.stops.map((s, i) => [i, s.hub ? 0 : timesOn(i, clockNow.ymd).length]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]);
  const out = [], taken = new Set();
  for (const [i] of counts) {
    const s = stop(i);
    if (taken.has(i) || out.some(j => distance(s.lat, s.lon, stop(j).lat, stop(j).lon) < 800)) continue;
    out.push(i); taken.add(i);
    if (s.twin) taken.add(s.twin[0]);
    if (out.length >= n) break;
  }
  busyFor = clockNow.ymd; busyList = out;
  return out;
}
/** The Transit Center as a line: when the next group leaves and how soon, its tab a tap away. It was a framed card
 *  with a 42 px time, between the rider's stop and the stops beside it. */
function hubLine(clockNow) {
  const p = nextPulse(1, clockNow)[0];
  if (!p) return '';
  const soon = p.day === 0 ? relative(p, clockNow) : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
  return html`<a class="land-hub" href="#/hub">${icon('hub', 18)}<span class="col"><span>${D.hub.name}</span><span class="sub">${(D.hub.pulseName || 'All routes').replace(/\s+leave$/, '')} leave at <b>${clockText(p.min)}</b> · ${soon}</span></span>${icon('fwd', 18)}</a>`;
}

/** The Aggie Shuttle as a line under the Center's, so a rider knows it's here too: its loops' colours, and whether
 *  it's running. To the map, on campus with its loops drawn. */
function shuttleLine(clockNow) {
  if (!U || !U.routes.some(r => r.stops.length)) return '';
  const dots = U.routes.filter(r => r.stops.length).map(r => html`<i style="background:${esc(r.color)}"></i>`);
  const n = live.buses.length && !isStale() && !offHours() ? live.buses.length : 0;   // out of hours, a bus reporting may be parked
  const w = [n ? `${n} ${n === 1 ? 'bus' : 'buses'} out` : '', shuttleWords(clockNow)].filter(Boolean).join(' · ');
  return html`<a class="land-hub land-usu" href="#/map/usu"><span class="udots" aria-hidden="true">${dots}</span><span class="col"><span>Aggie Shuttle</span><span class="sub">${w || 'USU’s campus loops'}</span></span>${icon('fwd', 18)}</a>`;
}

// ---- search, on its own page
let searchFull = null, fillLaterFor = null;   // the search last shown with its next buses; the one waiting for them
function searchPage(q, clockNow, app, pick = null) {
  const parts = [];
  // Picking one end for directions: every stop in the results leads to the journey from it (or to it), not its page.
  parts.push(html`<div class="titlebar m-only"><span class="wordmark">Cache Rider</span><button class="btn btn-secondary" id="near">${icon('near', 20)}Near me${app && app.geo ? html.raw(' <span class="muted">· on</span>') : ''}</button></div>`);
  if (pick) parts.push(html`<div class="notice pickfrom">${icon('route', 16)}<span>${pick.to ? 'Where will you start from?' : 'Where to?'} A stop, a place or an address. ${pick.to ? 'Going to' : 'Setting off from'} <b>${pick.name}</b></span></div>`);
  parts.push(html`<div class="pad"><form class="search" id="search" role="search" data-for="${pick && pick.to || ''}" data-from="${pick && pick.from || ''}"><input class="input" type="search" placeholder="${pick ? 'Stop, place or address' : 'Street, place or route, e.g. 500 North'}" value="${q}" autocomplete="off" aria-label="Search stops, places and routes"><span class="lead">${icon('search', 22)}</span></form></div>`);
  // Or on the map: a stop tapped, or any spot. Up top, beside the box, as the other way of saying where.
  if (pick) {
    const key = k => { const sp = spotOf(k); return sp ? spotKey(sp.lat, sp.lon, sp.label) : k; };
    parts.push(html`<div class="pad pickmap"><a class="btn btn-secondary btn-lg btn-block" href="${pick.to ? '#/map/from/' + key(pick.to) : '#/map/to/' + key(pick.from)}">${icon('map', 20)}${pick.to ? 'Pick the start on the map' : 'Pick where to on the map'}</a></div>`);
  }
  if (q) {
    // A new search's matches at once, as it's typed; their next buses the moment after (and in full on any redraw after).
    const later = q !== searchFull;
    if (later) requestAnimationFrame(() => setTimeout(() => { const el = document.getElementById('side'); if (el && fillLaterFor === q) { searchFull = q; fillLater(el); } }, 0));
    fillLaterFor = q;
    parts.push(results(q, clockNow, pick, later));
    return { html: parts.join(''), mount, title: 'Search' };
  }
  if (app && app.geo) parts.push(nearestSection(app.geo, clockNow));
  const rec = recent();
  if (rec.length) parts.push(html`<div class="section">${icon('history', 16)}Recent on this device</div><div class="list">${rec.map(id => stopRow(D.stopById[id], nextAt(D.stopById[id], 1, clockNow)[0], clockNow))}</div>`);
  parts.push(html`<div class="fine">Unofficial. Made by a rider, not by ${D.agency.brand}. Times come from ${D.agency.brand}'s published schedule, refreshed nightly. <a href="#/about">About this app</a></div>`);
  return { html: parts.join(''), mount, title: 'Search' };
}

let focusNext = false;   // arriving from the home page's box: the search's own box focused
function mount(el, app) {
  window.__app = app;
  wirePointers(el, app);
  const form = el.querySelector('#search');
  // Choosing one end of a journey: the stops listed lead to the journey from (or to) each.
  const pick = form && pickOf(form.dataset.for, form.dataset.from);
  if (pick) forPick(el, pick);
  // The home page's wide box, on a phone or a tablet, is a door, not a field: a tap into it is search, its box at the
  // top, focused, carrying anything typed, so the keyboard never covers it. The tap's own focus raises the keyboard
  // and the search's box takes the focus over in the same redraw, so the keyboard stays up. Beside the map (expanded)
  // it's a field as ever.
  const door = form && form.closest('.ask') && !isWide() ? form.querySelector('input') : null;
  if (door) { door.onfocus = () => { focusNext = true; const q = door.value.trim(); location.hash = '#/search' + (q ? '?q=' + encodeURIComponent(q) : ''); }; }
  else if (form) {
    const input = form.querySelector('input');
    form.onsubmit = e => { e.preventDefault(); go(input.value); };
    let t;
    input.oninput = () => { clearTimeout(t); const was = location.hash; t = setTimeout(() => { if (location.hash === was) go(input.value, true); }, 250); };   // not after a result's tapped
    if (input.value || focusNext) { focusNext = false; input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
  }
  for (const near of el.querySelectorAll('#near, #near-ask')) near.onclick = () => app.geo ? nearOff() : nearMe();
  wireInstall(el);
  const edit = el.querySelector('#edit-saved');
  if (edit) edit.onclick = () => { app.editSaved = !app.editSaved; window.dispatchEvent(new HashChangeEvent('hashchange')); };
  el.querySelectorAll('[data-move]').forEach(b => b.onclick = () => {
    const ids = saved(), i = ids.indexOf(b.dataset.id), j = i + (+b.dataset.move);
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]]; setSaved(ids);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  el.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => {
    setSaved(saved().filter(x => x !== b.dataset.remove));
    if (!saved().length) app.editSaved = false;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  el.querySelectorAll('[data-q]').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.q); });
}
function go(q, live = false) {
  q = q.trim();
  const form = document.getElementById('search'), pick = !form ? '' : form.dataset.for ? '&for=' + encodeURIComponent(form.dataset.for) : form.dataset.from ? '&from=' + encodeURIComponent(form.dataset.from) : '';
  const target = q ? '#/search?q=' + encodeURIComponent(q) + pick : pick ? '#/search?' + pick.slice(1) : '#/';
  if (location.hash === target) return;
  if (live) history.replaceState(null, '', target); else location.hash = target;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  if (live) { const i = document.querySelector('#search input'); if (i) { i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); } }
}

function nearestSection(geo, clockNow) {
  const near = byWalk(nearest(geo.lat, geo.lon, 16), geo.lat, geo.lon).slice(0, 12);
  const parts = [html`<div class="section">${icon('near', 16)}Nearest to you</div>`];
  const shown = new Set();
  let hubDone = false, count = 0;
  const rows = [];
  for (const { i, d } of near) {
    if (shown.has(i)) continue;
    const s = stop(i);
    if (s.hub) {
      if (hubDone) continue;
      hubDone = true;
      rows.push(html`<a class="stoprow" href="#/hub"><div class="mid"><span class="name">${D.hub.name}</span><span class="dist">${metres(d)} away · every route</span>${badges(D.routes.map((_, ri) => ri).filter(ri => D.hub.bays.some(b => b.routes.includes(ri))), 24)}</div><div class="end"><span class="muted">${icon('fwd', 20)}</span></div></a>`);
    } else if (s.twin && !shown.has(s.twin[0])) {
      const [ti, td] = s.twin;
      shown.add(ti);
      const a = side(i) || 'This side', b = side(ti) || 'Across the road';
      const street = commonStreet(s.name, stop(ti).name);
      rows.push(html`<div class="notice"><span>Twin stops${street ? ' · across ' + street + ' from each other' : ''} · ${metres(d)} away</span></div>`);
      rows.push(stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { dist: a === 'This side' ? 'Nearer side' : a + ' side' }));
      rows.push(stopRow(ti, nextAt(ti, 1, clockNow)[0], clockNow, { dist: (b === 'Across the road' ? b : b + ' side · across the road') }));
    } else {
      rows.push(stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { dist: metres(d) }));
    }
    shown.add(i);
    if (++count >= 5) break;
  }
  parts.push(html`<div class="list">${html.raw(rows.join(''))}</div>`);
  return parts.join('');
}
function commonStreet(a, b) {
  const wa = a.split(' ').slice(1), wb = b.split(' ').slice(1);
  const common = wa.filter(w => wb.includes(w));
  return common.length >= 2 ? common.join(' ') : '';
}

function editRow(id, i, n) {
  const campus = id.startsWith('u:') ? U.stops[U.stopById[id.slice(2)]] : null;
  const s = campus || stop(D.stopById[id]);
  if (!s) return '';
  const town = !campus && s.town && s.town !== 'Logan' ? `<span class="town">, ${esc(s.town)}</span>` : '';
  const marks = campus ? `<div class="badges wide">${s.routes.map(ri => chip(ri, 24).s).join('')}</div>` : badges(s.routes, 24).s;
  return `<div class="stoprow editrow"><div class="mid"><span class="name">${esc(s.name)}${town}</span>${marks}</div>
    <div class="end row-actions">
      <button class="btn btn-secondary btn-icon" data-move="-1" data-id="${esc(id)}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 18).s}</button>
      <button class="btn btn-secondary btn-icon" data-move="1" data-id="${esc(id)}" aria-label="Move down" ${i === n - 1 ? 'disabled' : ''}>${icon('chevDown', 18).s}</button>
      <button class="btn btn-secondary btn-icon" data-remove="${esc(id)}" aria-label="Remove">${icon('close', 18).s}</button>
    </div></div>`;
}
