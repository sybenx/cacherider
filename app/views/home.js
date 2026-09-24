// Home: useful without permission. Search, the next pulse, what this phone
// remembers, every route. With location on, the nearest stops first.
import { D, nextAt, nextPulse, nextFromHub, newTimetable, recent, saved, setSaved, search, nearest, stop, distance, pref } from '../data.js';
import { relative, fmtDay, metres } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, stopRow, side, esc } from '../ui.js';
import { nearMe, nearOff, installCard, wireInstall } from '../main.js';
import { parseAddress, geocode, townState } from '../geo.js';

export function render({ q }, clockNow) {
  const app = window.__app;
  const parts = [];
  parts.push(html`<div class="titlebar m-only"><span class="wordmark">Cache Rider</span><button class="btn btn-secondary" id="near">${icon('near', 20)}Near me${app && app.geo ? html.raw(' <span class="muted">· on</span>') : ''}</button></div>`);
  parts.push(html`<div class="pad"><form class="search" id="search" role="search"><input class="input" type="search" placeholder="Street or address, e.g. 500 North" value="${q}" autocomplete="off" aria-label="Search stops"><span class="lead">${icon('search', 22)}</span></form></div>`);

  if (q) {
    parts.push(results(q, clockNow));
    return { html: parts.join(''), mount, title: 'Search' };
  }

  const nt = newTimetable(clockNow);
  if (nt) parts.push(html`<div class="notice">${icon('calendar', 16)}<span>New timetable starts <b>${fmtDay(nt)}</b></span></div>`);
  parts.push(installCard());
  parts.push(pulseCard(clockNow));

  if (app && app.geo) parts.push(nearestSection(app.geo, clockNow));

  const sv = saved();
  if (sv.length) {
    const editing = app && app.editSaved;
    parts.push(html`<div class="section saved">${icon('star', 16)}Saved stops<button class="btn btn-ghost edit" id="edit-saved">${editing ? 'Done' : 'Edit'}</button></div>
      <div class="list">${editing ? html.raw(sv.map((id, i) => editRow(id, i, sv.length)).join('')) : sv.map(id => stopRow(D.stopById[id], nextAt(D.stopById[id], 1, clockNow)[0], clockNow))}</div>`);
  } else {
    const rec = recent();
    if (rec.length) {
      parts.push(html`<div class="section">${icon('history', 16)}Recent on this phone</div><div class="list">${rec.map(id => stopRow(D.stopById[id], nextAt(D.stopById[id], 1, clockNow)[0], clockNow))}</div>`);
    }
  }

  parts.push(html`<div class="section">${icon('route', 16)}Browse by route</div><div class="routes">${D.routes.map((r, i) => html`<a href="#/route/${encodeURIComponent(r.short)}" aria-label="Route ${r.short}">${badge(i, 36)}</a>`)}</div>`);
  parts.push(html`<div class="fine">Unofficial. Made by a rider, not by ${D.agency.brand}. Times come from ${D.agency.brand}'s published schedule, refreshed nightly. <a href="#/about">About this app</a></div>`);
  return { html: parts.join(''), mount, title: '' };
}

function mount(el, app) {
  window.__app = app;
  const form = el.querySelector('#search');
  const input = form.querySelector('input');
  form.onsubmit = e => { e.preventDefault(); go(input.value); };
  let t;
  input.oninput = () => { clearTimeout(t); t = setTimeout(() => go(input.value, true), 250); };
  const near = el.querySelector('#near');
  if (near) near.onclick = () => app.geo ? nearOff() : nearMe();
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
  if (input.value) input.focus({ preventScroll: true });
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
  if (!hits.length && !places.length) {
    return html`<div class="empty"><h2>No stops match “${q}”</h2><p>Stop names are street addresses. Try a street or a town, or any address in the valley, like “4182 S 800 W, Preston”, for the stops nearest it.</p></div>
      <div class="chips">${['Main St', '400 North', 'Hyrum', 'USU', 'Smithfield'].map(s => html`<a class="chip" href="#/search?q=${encodeURIComponent(s)}" data-q="${s}">${s}</a>`)}</div>
      <div class="section">${icon('route', 16)}Or browse by route</div><div class="routes">${D.routes.map((r, i) => html`<a href="#/route/${encodeURIComponent(r.short)}">${badge(i, 36)}</a>`)}</div>`;
  }
  const towns = [...new Set(hits.map(i => stop(i).town))];
  const where = towns.length === 1 ? ' in ' + towns[0] : '';
  if (!hits.length) return html`${html.raw(addrHtml)}<div class="fine">Any grid address in the valley works, with or without the town: the stops nearest it are listed, nearest first. Where the same address exists in more than one town, each is shown.</div>`;
  return html`${html.raw(addrHtml)}
    <div class="${places.length ? 'section' : 'notice'}"><span>${places.length ? 'Stops named like that' : `${hits.length} ${hits.length === 1 ? 'stop' : 'stops'}${where} · sorted by street number`}</span></div>
    <div class="list">${hits.map(i => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow))}</div>
    <div class="fine">Matches street, number and town: “500 north”, “main st, hyrum” and “hyrum main” all work. So does any address in the valley, like “4182 S 800 W, Preston”, for the stops nearest it.</div>`;
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
  const s = stop(D.stopById[id]);
  const town = s.town && s.town !== 'Logan' ? `<span class="town">, ${esc(s.town)}</span>` : '';
  return `<div class="stoprow editrow"><div class="mid"><span class="name">${esc(s.name)}${town}</span>${badges(s.routes, 24).s}</div>
    <div class="end row-actions">
      <button class="btn btn-secondary btn-icon" data-move="-1" data-id="${esc(id)}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>${icon('up', 18).s}</button>
      <button class="btn btn-secondary btn-icon" data-move="1" data-id="${esc(id)}" aria-label="Move down" ${i === n - 1 ? 'disabled' : ''}>${icon('chevDown', 18).s}</button>
      <button class="btn btn-secondary btn-icon" data-remove="${esc(id)}" aria-label="Remove">${icon('close', 18).s}</button>
    </div></div>`;
}
