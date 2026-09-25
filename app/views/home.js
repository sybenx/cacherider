// Home, the watchface on the phone: one answer set large, when the next bus
// leaves your stop. A saved stop takes the hero; without one, the nearest
// stop; without location, the Transit Center pulse, with both systems and one
// ask for location beneath it. Search lives on its own page.
import { D, nextAt, nextPulse, nextFromHub, nextServiceDay, newTimetable, recent, saved, setSaved, search, nearest, stop, distance, pref, systemAlerts, activeAlerts } from '../data.js';
import { relative, fmtDay, metres, clock, clockText, dayName } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, stopRow, side, esc, headsign, liveMark } from '../ui.js';
import { lateWords } from '../rt.js';
import { nearMe, nearOff, installCard, wireInstall } from '../main.js';
import { parseAddress, geocode, townState } from '../geo.js';
import { U, searchUSU, stopRowU, chip, liveTag, live, hasData, board } from '../usu.js';

export function render({ q, page }, clockNow) {
  const app = window.__app;
  if (page === 'search' || q) return searchPage(q, clockNow, app);
  return landing(clockNow, app);
}

// ---- the landing
function landing(clockNow, app) {
  const sv = saved();
  const firstSaved = sv.find(id => !id.startsWith('u:') && D.stopById[id] !== undefined);
  let heroSi, heroWhy = '';
  if (firstSaved !== undefined) { heroSi = D.stopById[firstSaved]; heroWhy = 'Next bus'; }
  else if (app && app.geo) {
    const n = nearest(app.geo.lat, app.geo.lon, 3).find(x => !stop(x.i).hub);
    if (n) { heroSi = n.i; heroWhy = 'Nearest · ' + metres(n.d); }
  }
  const stopHero = heroSi !== undefined;
  const geo = app && app.geo;
  const [dow, date, mon] = fmtDay(clockNow.ymd).split(' ');
  const parts = [html`<div class="land-top m-only"><span class="wordmark">Cache Rider</span><span class="land-right"><span class="land-date">${dow} <span class="muted">${mon} ${date}</span></span>
    <button class="btn btn-ghost btn-icon" id="near" type="button" aria-label="${geo ? 'Location on · turn off' : 'Sort stops by distance'}" aria-pressed="${geo ? 'true' : 'false'}" title="${geo ? 'Location on' : 'Near me'}">${icon('near', 22)}</button>
    <a class="btn btn-ghost btn-icon" href="#/search" aria-label="Search">${icon('search', 22)}</a></span></div>`];
  for (const a of systemAlerts(clockNow.ymd)) parts.push(html`<div class="callout alert land-alert">${icon('info', 20)}<div><b>${a.title}</b><div class="sub">${a.text}</div></div></div>`);

  parts.push(stopHero ? stopHeroBlock(heroSi, heroWhy, clockNow) : pulseHeroBlock(clockNow));
  parts.push(html`<div class="spacer"></div>`);

  if (stopHero) {
    parts.push(hubLine(clockNow));
    if (sv.length) {
      const editing = app && app.editSaved;
      const others = sv.filter(id => id !== firstSaved);
      parts.push(html`<div class="land-eye"><span>Saved</span><button class="btn btn-ghost edit" id="edit-saved">${editing ? 'Done' : 'Edit'}</button></div>`);
      if (editing) parts.push(html`<div class="list">${html.raw(sv.map((id, i) => editRow(id, i, sv.length)).join(''))}</div>`);
      else if (others.length) parts.push(html`<div class="list">${others.map(id => id.startsWith('u:') ? (U && U.stopById[id.slice(2)] !== undefined ? stopRowU(U.stopById[id.slice(2)]) : '') : stopRow(D.stopById[id], nextAt(D.stopById[id], 1, clockNow)[0], clockNow))}</div>`);
    } else if (geo) {
      const rows = nearest(geo.lat, geo.lon, 6).filter(x => x.i !== heroSi && !stop(x.i).hub).slice(0, 3);
      parts.push(html`<div class="land-eye"><span>Also near you</span></div><div class="list">${rows.map(({ i, d }) => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { dist: metres(d) }))}</div>`);
    }
  } else if (geo) {
    const rows = nearest(geo.lat, geo.lon, 5).filter(x => !stop(x.i).hub).slice(0, 3);
    if (rows.length) parts.push(html`<div class="land-eye"><span>Nearest to you</span></div><div class="list">${rows.map(({ i, d }) => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { dist: metres(d) }))}</div>`);
  } else {
    parts.push(html`<div class="ask">
      <form class="search" id="search" role="search"><input class="input" type="search" placeholder="Street or address, e.g. 500 North" autocomplete="off" aria-label="Search stops"><span class="lead">${icon('search', 22)}</span></form>
      <button class="btn btn-primary btn-lg blueprint" id="near-ask" type="button">${corners()}${icon('near', 20)}Show the stops near me</button>
      <span class="ask-note">Location stays on this phone, used only to sort stops.</span></div>`);
  }
  parts.push(chips());
  const nt = newTimetable(clockNow);
  if (nt) parts.push(html`<div class="notice">${icon('calendar', 16)}<span>New timetable starts <b>${fmtDay(nt)}</b></span></div>`);
  const detours = activeAlerts(clockNow.ymd).filter(a => (a.stops || []).length || (a.routes || []).length);
  if (detours.length) {
    const rs = [...new Set(detours.flatMap(a => a.routes || []))].sort((x, y) => +x - +y);
    parts.push(html`<div class="notice">${icon('ban', 16)}<span><b>${detours.length} ${detours.length === 1 ? 'detour' : 'detours'}</b>${rs.length ? ' on route' + (rs.length > 1 ? 's ' : ' ') + rs.join(', ') : ''} · <a href="#/about">details</a></span></div>`);
  }
  if (sv.length) parts.push(installCard());   // the offer waits until a rider has saved a stop: proof it's their app
  parts.push(html`<div class="fine">Unofficial. Made by a rider, not by ${D.agency.brand}. Times come from ${D.agency.brand}'s published schedule, refreshed nightly. <a href="#/about">About this app</a></div>`);
  if (app) app.hasCampusSaved = sv.some(id => id.startsWith('u:'));
  return { html: html`<div class="land">${html.raw(parts.join(''))}</div>`.s, mount, title: '' };
}

/** Every route as a chip: Connect's badges, then the shuttle's in their own colours. */
function chips() {
  const connect = D.routes.map((r, i) => html`<a href="#/route/${encodeURIComponent(r.short)}" aria-label="Route ${r.short}">${badge(i, 36)}</a>`);
  const campus = U ? U.routes.map((r, ri) => r.stops.length ? html`<a href="#/usu/route/${r.id}" aria-label="${r.name}">${chip(ri, 36)}</a>` : '') : [];
  return html`<div class="land-eye"><span>Routes</span></div><div class="routes">${connect}</div>${campus.some(Boolean) ? html`<div class="land-eye"><span>Aggie Shuttle</span></div><div class="routes campus">${campus}</div>` : ''}`;
}

/** The giant time: hours, the two accent squares of the colon, minutes. */
function giant(min) {
  const c = clock(min), [hh, mm] = c.h.split(':');
  return html`<div class="giant" aria-label="${c.h} ${c.ap}"><span>${hh}</span><span class="colon"><i></i><i></i></span><span>${mm}</span></div>`;
}

function stopHeroBlock(si, why, clockNow) {
  const s = stop(si);
  const next = nextAt(si, 3, clockNow);
  const eye = html`<div class="eye"><span class="eyebrow">${why} · Stop ${s.code || s.id}</span>${next[0] && next[0].live ? liveMark('Live · ' + lateWords(next[0].live.delay)) : sched()}</div>`;
  if (!next.length) {
    const resume = nextServiceDay(clockNow);
    return html`<div class="hero">${eye}<a class="hero-main" href="#/stop/${s.id}"><span class="stopname">${s.name}</span><div class="hero-none">Nothing scheduled${resume && resume !== clockNow.ymd ? html`<span class="sub">Buses resume ${fmtDay(resume, true)}</span>` : ''}</div></a></div>`;
  }
  const first = next[0];
  const left = first.day === 0 ? first.min - clockNow.min : null;
  const countdown = left !== null && left <= 10;
  const big = countdown
    ? html`<div class="giant count"><span>${left <= 0 ? 'NOW' : left}</span>${left > 0 ? html`<span class="unit">MIN</span>` : ''}</div>`
    : giant(first.min);
  const sideVal = countdown ? time(first.min, 34) : first.day === 0 ? html`<span class="rt">${relative(first, clockNow)}</span>` : '';
  const dayWord = first.day === 0 ? '' : first.day === 1 ? 'Tomorrow' : dayName(first.ymd);
  const then = next.slice(1);
  const dest = String(headsign(first)), long = D.routes[first.r].long;
  return html`<div class="hero">${eye}<a class="hero-main" href="#/stop/${s.id}"><span class="stopname">${s.name}</span>${big}
    <div class="who">${badge(first.r, 44)}<div class="mid"><span class="dest">${html.raw(dest)}</span>${dayWord || dest.replace(/<[^>]+>/g, '') !== long ? html`<span class="sub">${[dayWord, dest.replace(/<[^>]+>/g, '') !== long ? long : ''].filter(Boolean).join(' · ')}</span>` : ''}</div>${sideVal}</div>
    ${then.length ? html`<div class="then"><span class="eyebrow muted">Then</span>${then.map(t => html`<span class="t t-26">${time(t.min, 26)}${t.day !== first.day ? html`<small class="day">${t.day === 1 ? 'tomorrow' : dayName(t.ymd, true)}</small>` : ''}</span>`)}</div>` : ''}</a></div>`;
}

function pulseHeroBlock(clockNow) {
  const p = nextPulse(1, clockNow)[0];
  const eye = html`<div class="eye"><span class="eyebrow">${D.agency.brand} · ${D.hub.name}</span>${sched()}</div>`;
  if (!p) {
    const resume = nextServiceDay(clockNow);
    return html`<div class="hero">${eye}<a class="hero-main" href="#/hub"><span class="stopname">${D.hub.name}</span><div class="hero-none">No buses today${resume ? html`<span class="sub">Service resumes ${fmtDay(resume, true)}</span>` : ''}</div></a></div>`;
  }
  const loops = (D.hub.loops || []).map(ri => { const n = nextFromHub(ri, 1, clockNow)[0]; return n ? html`<div class="loop">${badge(ri, 28)}<div class="col">${time(n.min, 22)}<span class="sub">${D.routes[ri].long}</span></div></div>` : ''; });
  const when = p.day === 0 ? relative(p, clockNow) : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
  return html`<div class="hero">${eye}<a class="hero-main" href="#/hub"><span class="stopname">${(D.hub.pulseName || 'Every route').replace(/\s+leave$/, '')}</span>${giant(p.min)}
    <div class="who"><span class="dest">${D.routes.length} routes from the ${D.hub.name}</span><span class="rt">${when}</span></div>
    ${loops.some(Boolean) ? html`<div class="loops">${loops}</div>` : ''}</a></div>`;
}

/** The Transit Center as one line in a blueprint frame, under a stop hero. */
function hubLine(clockNow) {
  const p = nextPulse(1, clockNow)[0];
  if (!p) return '';
  const when = p.day === 0 ? relative(p, clockNow) : p.day === 1 ? 'tomorrow' : dayName(p.ymd);
  return html`<a class="land-pulse blueprint" href="#/hub">${corners()}<div class="col"><span class="eyebrow">${D.hub.name} · ${(D.hub.pulseName || 'all routes').replace(/\s+leave$/, '')}</span><div class="line">${time(p.min, 42)}<span class="sub">${when}</span></div></div><span class="muted">${icon('fwd', 20)}</span></a>`;
}



// ---- search, on its own page
function searchPage(q, clockNow, app) {
  const parts = [];
  parts.push(html`<div class="titlebar m-only"><span class="wordmark">Cache Rider</span><button class="btn btn-secondary" id="near">${icon('near', 20)}Near me${app && app.geo ? html.raw(' <span class="muted">· on</span>') : ''}</button></div>`);
  parts.push(html`<div class="pad"><form class="search" id="search" role="search"><input class="input" type="search" placeholder="Street or address, e.g. 500 North" value="${q}" autocomplete="off" aria-label="Search stops"><span class="lead">${icon('search', 22)}</span></form></div>`);
  if (q) { parts.push(results(q, clockNow)); return { html: parts.join(''), mount, title: 'Search' }; }
  if (app && app.geo) parts.push(nearestSection(app.geo, clockNow));
  const rec = recent();
  if (rec.length) parts.push(html`<div class="section">${icon('history', 16)}Recent on this phone</div><div class="list">${rec.map(id => stopRow(D.stopById[id], nextAt(D.stopById[id], 1, clockNow)[0], clockNow))}</div>`);
  parts.push(html`<div class="section">${icon('route', 16)}Browse by route</div><div class="routes">${D.routes.map((r, i) => html`<a href="#/route/${encodeURIComponent(r.short)}" aria-label="Route ${r.short}">${badge(i, 36)}</a>`)}</div>`);
  parts.push(html`<div class="fine">Unofficial. Made by a rider, not by ${D.agency.brand}. Times come from ${D.agency.brand}'s published schedule, refreshed nightly. <a href="#/about">About this app</a></div>`);
  return { html: parts.join(''), mount, title: 'Search' };
}

function mount(el, app) {
  window.__app = app;
  const form = el.querySelector('#search');
  if (form) {
    const input = form.querySelector('input');
    form.onsubmit = e => { e.preventDefault(); go(input.value); };
    let t;
    input.oninput = () => { clearTimeout(t); t = setTimeout(() => go(input.value, true), 250); };
    if (input.value) input.focus({ preventScroll: true });
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
  const target = q ? '#/search?q=' + encodeURIComponent(q) : '#/';
  if (location.hash === target) return;
  if (live) history.replaceState(null, '', target); else location.hash = target;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  if (live) { const i = document.querySelector('#search input'); if (i) { i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length); } }
}

function results(q, clockNow) {
  const hits = search(q);
  const addr = parseAddress(q);
  const places = addr ? geocode(addr, 4) : [];
  const addrHtml = places.map(pl => html`
    <div class="section between"><span>${pl.label} · ${pl.town}${townState(pl.town)}${pl.near ? html.raw(`<span class="note"> · near ${esc(pl.near)}</span>`) : ''}</span><a class="note" href="#/map/at/${pl.lat.toFixed(5)},${pl.lon.toFixed(5)}/${encodeURIComponent(pl.label + ', ' + pl.town)}">Show on map</a></div>
    <div class="list">${pl.stops.length ? pl.stops.map(({ i, d }) => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow, { dist: metres(d) + ' away' })) : html`<div class="empty"><p>No stops near there.</p></div>`}</div>`).join('');
  const us = searchUSU(q);
  const campusHtml = (us.stops.length || us.routes.length) ? html`
    <div class="notice"><span>${us.stops.length ? us.stops.length + (us.stops.length === 1 ? ' campus stop' : ' campus stops') : ''}${us.stops.length && us.routes.length ? ' · ' : ''}${us.routes.length ? us.routes.length + (us.routes.length === 1 ? ' route' : ' routes') : ''}</span></div>
    ${us.stops.length ? html`<div class="section">${icon('stops', 16)}Campus stops</div><div class="list">${us.stops.map(i => stopRowU(i))}</div>` : ''}
    ${us.routes.length ? html`<div class="section">${icon('route', 16)}Shuttle routes</div><div class="list">${us.routes.map(ri => { const r = U.routes[ri]; const n = live.buses.filter(b => b.ri === ri).length; return html`<a class="row" href="#/usu/route/${r.id}">${chip(ri, 36)}<div class="mid"><span class="name">${r.name}</span><span class="sub">${r.stops.length} stops · ${hasData() ? (n ? n + (n === 1 ? ' bus' : ' buses') + ' on the road' : 'no bus on the road') : 'finding buses…'}</span></div><span class="muted">${icon('fwd', 20)}</span></a>`; })}</div>` : ''}`.s : '';
  if (!hits.length && !places.length && !campusHtml) {
    return html`<div class="empty"><h2>No stops match “${q}”</h2><p>Stop names are street addresses. Try a street or a town, or any address in the valley, like “1400 N 500 E, Logan”, for the stops nearest it.</p></div>
      <div class="chips">${['Main St', '400 North', 'Hyrum', 'USU', 'Smithfield'].map(s => html`<a class="chip" href="#/search?q=${encodeURIComponent(s)}" data-q="${s}">${s}</a>`)}</div>
      <div class="section">${icon('route', 16)}Or browse by route</div><div class="routes">${D.routes.map((r, i) => html`<a href="#/route/${encodeURIComponent(r.short)}">${badge(i, 36)}</a>`)}</div>`;
  }
  const towns = [...new Set(hits.map(i => stop(i).town))];
  const where = towns.length === 1 ? ' in ' + towns[0] : '';
  if (!hits.length) return html`${html.raw(campusHtml)}${html.raw(addrHtml)}<div class="fine">Any grid address in the valley works, with or without the town: the stops nearest it are listed, nearest first. Where the same address exists in more than one town, each is shown.</div>`;
  return html`${html.raw(campusHtml)}${html.raw(addrHtml)}
    <div class="${places.length || campusHtml ? 'section' : 'notice'}"><span>${places.length ? 'Stops named like that' : `${hits.length} ${hits.length === 1 ? 'stop' : 'stops'}${where} · sorted by street number`}</span></div>
    <div class="list">${hits.map(i => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow))}</div>
    <div class="fine">Matches street, number and town: “500 north”, “main st, hyrum” and “hyrum main” all work. So does any address in the valley, like “1400 N 500 E, Logan”, for the stops nearest it.</div>`;
}

function pulseCard(clockNow) {
  const p = nextPulse(1, clockNow)[0];
  if (!p) return '';
  const loops = D.hub.loops || [];
  const loopRows = loops.map(ri => {
    const n = nextFromHub(ri, 1, clockNow)[0];
    if (!n) return '';
    const r = D.routes[ri];
    return html`<div class="loop">${badge(ri, 28)}<div class="col">${time(n.min, 20)}<span class="rel">${r.long.replace(/ Loop$/, '')} · ${relative(n, clockNow)}</span></div></div>`;
  }).join('');
  const day = p.day === 0 ? '' : p.day === 1 ? ' tomorrow' : ' ' + relative(p, clockNow);
  return html`<a class="pulse blueprint" href="#/hub">${corners()}
    <div class="top"><span class="eyebrow">${D.hub.pulseName || 'Next pulse'}</span><span class="muted">${icon('fwd', 20)}</span></div>
    <div class="big">${time(p.min, 42)}<span class="rel">${relative(p, clockNow)}</span></div>
    <div class="sub">${D.hub.pulseLabel}${day}</div>
    ${loopRows ? html`<div class="loops">${html.raw(loopRows)}</div>` : ''}
    <div class="foot">${sched()}</div></a>`;
}

function nearestSection(geo, clockNow) {
  const near = nearest(geo.lat, geo.lon, 12);
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
