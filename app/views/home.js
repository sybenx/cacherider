// Home: useful without permission. Search, the next pulse, what this phone
// remembers, every route. With location on, the nearest stops first.
import { D, nextAt, nextPulse, nextFromHub, newTimetable, recent, search, nearest, stop, distance, pref } from '../data.js';
import { relative, fmtDay, metres } from '../time.js';
import { html, icon, badge, badges, time, sched, corners, stopRow, side, esc } from '../ui.js';
import { nearMe, nearOff } from '../main.js';

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
  parts.push(pulseCard(clockNow));

  if (app && app.geo) parts.push(nearestSection(app.geo, clockNow));

  const rec = recent();
  if (rec.length) {
    parts.push(html`<div class="section">${icon('history', 16)}Recent on this phone</div><div class="list">${rec.map(id => stopRow(D.stopById[id], nextAt(D.stopById[id], 1, clockNow)[0], clockNow))}</div>`);
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
  if (!hits.length) {
    return html`<div class="empty"><h2>No stops match “${q}”</h2><p>Stop names are street addresses. Try a street or a town.</p></div>
      <div class="chips">${['Main St', '400 North', 'Hyrum', 'USU', 'Smithfield'].map(s => html`<a class="chip" href="#/search?q=${encodeURIComponent(s)}" data-q="${s}">${s}</a>`)}</div>
      <div class="section">${icon('route', 16)}Or browse by route</div><div class="routes">${D.routes.map((r, i) => html`<a href="#/route/${encodeURIComponent(r.short)}">${badge(i, 36)}</a>`)}</div>`;
  }
  const towns = [...new Set(hits.map(i => stop(i).town))];
  const where = towns.length === 1 ? ' in ' + towns[0] : '';
  return html`<div class="notice"><span>${hits.length} ${hits.length === 1 ? 'stop' : 'stops'}${where} · sorted by street number</span></div>
    <div class="list">${hits.map(i => stopRow(i, nextAt(i, 1, clockNow)[0], clockNow))}</div>
    <div class="fine">Matches street, number and town. “500 north”, “main st, hyrum” and “hyrum main” all work.</div>`;
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
