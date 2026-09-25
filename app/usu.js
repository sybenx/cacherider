// The USU campus shuttle: no timetable, only where each bus is. The routes,
// stops and loops come from data/usu.json (snapshotted nightly); the buses
// from the Passio GO feed, polled by the phone while a live screen is open.
// Minutes are estimated from a bus's position along its loop.
import { BASE, D, distance } from './data.js';
import { esc, raw, html, icon } from './ui.js';
import { metres, now, dayFrom } from './time.js';

export let U = null;
const FEED = 'https://passiogo.com/mapGetData.php';
const POLL = 12000, STALE = 60000, SPEED = 5.5, DWELL = 20;   // m/s between stops, seconds per stop

export async function loadUSU() {
  if (U) return U;
  try { U = await (await fetch(BASE + 'data/usu.json')).json(); } catch { return null; }
  U.stopById = Object.fromEntries(U.stops.map((s, i) => [s.id, i]));
  U.routeById = Object.fromEntries(U.routes.map((r, i) => [r.id, i]));
  // Each loop's cumulative distance, and every stop's place along it.
  for (const r of U.routes) {
    r.cum = [0];
    for (let i = 1; i < r.shape.length; i++) r.cum.push(r.cum[i - 1] + distance(r.shape[i - 1][1], r.shape[i - 1][0], r.shape[i][1], r.shape[i][0]));
    r.length = r.cum[r.cum.length - 1] || 1;
    r.stopAlong = {};
    for (const si of r.stops) r.stopAlong[si] = along(r, U.stops[si].lat, U.stops[si].lon).along;
    // If stops run backwards along the drawn loop, the loop is drawn against traffic: flip it.
    const seq = r.stops.map(si => r.stopAlong[si]);
    let fwd = 0, back = 0;
    for (let i = 1; i < seq.length; i++) (seq[i] >= seq[i - 1] ? fwd++ : back++);
    if (back > fwd && r.shape.length) {
      r.shape.reverse(); r.cum = [0];
      for (let i = 1; i < r.shape.length; i++) r.cum.push(r.cum[i - 1] + distance(r.shape[i - 1][1], r.shape[i - 1][0], r.shape[i][1], r.shape[i][0]));
      for (const si of r.stops) r.stopAlong[si] = along(r, U.stops[si].lat, U.stops[si].lon).along;
    }
  }
  // Campus stops that share a kerb with a Connect stop.
  U.shared = {}; U.sharedByCvtd = {};
  for (let i = 0; i < U.stops.length; i++) {
    let best = null;
    for (let j = 0; j < D.stops.length; j++) {
      const d = distance(U.stops[i].lat, U.stops[i].lon, D.stops[j].lat, D.stops[j].lon);
      if (d <= 45 && (!best || d < best.d)) best = { j, d };
    }
    if (best) { U.shared[i] = best; U.sharedByCvtd[best.j] = { i, d: best.d }; }
  }
  return U;
}

/** Where a point sits along a loop: metres from its start, and the nearest vertex. */
function along(r, lat, lon) {
  let best = { d: Infinity, i: 0, along: 0 };
  for (let i = 0; i < r.shape.length; i++) {
    const d = distance(lat, lon, r.shape[i][1], r.shape[i][0]);
    if (d < best.d) best = { d, i, along: r.cum[i] };
  }
  return best;
}

// ---- live
export const live = { buses: [], at: 0, feedTime: '', error: null, wanted: false, fetching: false };
let timer = null;
const listeners = new Set();
export function onLive(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function setWanted(w) {
  live.wanted = w;
  if (w && !timer) timer = setInterval(() => tick(false), POLL);
  if (!w && timer) { clearInterval(timer); timer = null; }
  if (w && Date.now() - live.at > POLL) tick(true);
}
export const refresh = () => tick(true);
async function tick(force) {
  if (!live.wanted || live.fetching || !U) return;
  if (!force && document.visibilityState !== 'visible') return;   // the timer waits for the screen to be looked at
  live.fetching = true;
  try {
    const r = await fetch(FEED + '?getBuses=1&deviceId=1', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'json=' + JSON.stringify({ s0: U.system, sA: 1 }) });
    const j = await r.json();
    const buses = [];
    for (const list of Object.values(j.buses || {})) for (const b of list) {
      const ri = U.routeById[String(b.routeId)];
      if (ri === undefined || b.outOfService === 1 || b.outdated === 1) continue;
      const lat = +b.latitude, lon = +b.longitude, rt = U.routes[ri];
      const a = rt.shape.length ? along(rt, lat, lon) : { along: 0, d: 0 };
      buses.push({ id: String(b.deviceId), name: b.busName || b.bus, ri, lat, lon, course: +b.calculatedCourse || 0, pax: +b.paxLoad || 0, cap: +b.totalCap || 0, along: a.along, off: a.d, created: b.created });
    }
    live.buses = buses; live.at = Date.now(); live.error = null;
    live.feedTime = (j.time && j.time[U.system]) || '';
  } catch (e) {
    live.error = e.message || 'unreachable';
  }
  live.fetching = false;
  for (const fn of listeners) fn();
}
export const isStale = () => live.at > 0 && Date.now() - live.at > STALE;
export const hasData = () => live.at > 0;
export const noBuses = () => live.at > 0 && !live.buses.length;
export function lastSeen() { const d = new Date(live.at); let h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ':' + String(m).padStart(2, '0'); }

/** The nearest bus on a route to a stop, in the direction of travel: stops away and minutes. */
export function estimate(si, ri) {
  const r = U.routes[ri];
  if (!r.shape.length) {
    // No drawn loop: as the crow flies, no count of stops.
    let best = null;
    for (const b of live.buses) if (b.ri === ri) { const d = distance(b.lat, b.lon, U.stops[si].lat, U.stops[si].lon); if (!best || d < best.d) best = { bus: b, d }; }
    if (!best) return null;
    return { bus: best.bus, d: best.d, stops: null, min: Math.max(1, Math.round(best.d * 1.4 / SPEED / 60)), here: best.d < 60 };
  }
  const target = r.stopAlong[si];
  let best = null;
  for (const b of live.buses) {
    if (b.ri !== ri) continue;
    const d = ((target - b.along) % r.length + r.length) % r.length;
    if (!best || d < best.d) best = { bus: b, d };
  }
  if (!best) return null;
  let between = 0;
  for (const other of r.stops) {
    if (other === si) continue;
    const a = r.stopAlong[other];
    const da = ((a - best.bus.along) % r.length + r.length) % r.length;
    if (da > 0 && da < best.d) between++;
  }
  const secs = best.d / SPEED + between * DWELL;
  return { bus: best.bus, d: best.d, stops: between + 1, min: Math.max(1, Math.round(secs / 60)), here: best.d < 60 };
}

/** Every route at a stop, with its estimate, nearest first; routes with no bus last. */
export function board(si) {
  const rows = U.stops[si].routes.map(ri => ({ ri, est: estimate(si, ri) }));
  rows.sort((a, b) => (a.est ? a.est.min : 1e9) - (b.est ? b.est.min : 1e9));
  return rows;
}

/** A bus's next stops along its loop, with minutes. */
export function busNext(b, n = 5) {
  const r = U.routes[b.ri];
  const out = r.stops.map(si => {
    const d = ((r.stopAlong[si] - b.along) % r.length + r.length) % r.length;
    return { si, d };
  }).sort((x, y) => x.d - y.d).slice(0, n);
  return out.map((s, i) => ({ ...s, min: Math.max(0, Math.round((s.d / SPEED + i * DWELL) / 60)), here: s.d < 60 }));
}

export function heading(course) {
  const names = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
  return names[Math.round(((course % 360) + 360) % 360 / 45) % 8];
}
export function loadWords(b) {
  if (!b.cap) return '';
  const f = b.pax / b.cap;
  if (b.pax === 0) return 'Empty';
  if (f < 0.4) return 'About a third full · seats free';
  if (f < 0.7) return 'About two-thirds full';
  if (f < 0.95) return 'Nearly full';
  return 'Full';
}

// ---- pieces
export function chip(ri, size = 30) {
  const r = U.routes[ri];
  const fs = size >= 36 ? 17 : size >= 32 ? 15 : 14;
  return raw(`<span class="uchip" style="min-width:${size}px;height:${size}px;font-size:${fs}px;background:${esc(r.color)};color:${esc(r.text)}" title="${esc(r.name)}">${esc(r.short)}</span>`);
}
export function chips(ris, size = 30) { return raw(`<div class="badges wide">${ris.map(ri => chip(ri, size).s).join('')}</div>`); }
export function meter(b, wide = false) {
  if (!b.cap) return raw('');
  const n = b.pax === 0 ? 0 : Math.max(1, Math.round(b.pax / b.cap * 5));
  return raw(`<span class="meter${wide ? ' wide' : ''}" role="img" aria-label="${b.pax} aboard, room for ${b.cap}" title="${b.pax} of ${b.cap} aboard">${[0, 1, 2, 3, 4].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`);
}
export const liveTag = (text = 'Live') => raw(`<span class="livetag"><i></i>${esc(text)}</span>`);
/** Outside the shuttle's usual hours (from the hints; USU's page, not a feed), for these routes. */
export function offHours(ris = null, clockNow = now()) {
  const svc = U && U.service;
  if (!svc) return false;
  const idx = (dayFrom(clockNow.ymd).dow + 6) % 7;
  const names = (ris === null ? U.routes.map((_, i) => i) : ris).map(ri => U.routes[ri].name);
  const end = Math.max(svc.end, ...names.map(n => (svc.late || {})[n] || 0));
  return !svc.days[idx] || clockNow.min < svc.start || clockNow.min >= end;
}
/** The note itself, only while a bus is reporting: it may be parked with its tracker on. */
export const offNote = (ris = null) => live.buses.length && offHours(ris) ? raw(`<div class="fine offhours">Outside the shuttle's usual hours. A bus reporting now may not be in service.</div>`) : '';
export const notice = () => raw(`<div class="notice"><span class="muted">${icon('info', 16).s}</span><span>Shuttles have no timetable. Minutes are estimated from where each bus is right now.</span></div>`);

/** One campus-stop row: chip · route name + meter + LIVE · stops away + minutes. */
export function liveRow(row, opts = {}) {
  const r = U.routes[row.ri], e = row.est, stale = isStale();
  if (!e) return raw(`<div class="row urow off">${chip(row.ri, 36).s}<div class="mid"><span class="name muted">${esc(r.name)}</span><span class="sub">No bus on the road right now</span></div><span></span></div>`);
  const tag = stale ? liveTag('Last seen ' + lastSeen()) : liveTag();
  const big = e.here ? 'Here' : e.stops === null ? (stale ? metres(e.d) : e.min + ' min') : e.stops + (e.stops === 1 ? ' stop' : ' stops');
  const sub = e.here ? (stale ? 'at ' + lastSeen() : 'now') : e.stops === null ? (stale ? 'away at ' + lastSeen() : 'away · ' + metres(e.d)) : stale ? 'away at ' + lastSeen() : 'away · about ' + e.min + ' min';
  return raw(`<a class="row urow" href="${opts.href || '#/usu/route/' + esc(r.id)}">${chip(row.ri, 36).s}<div class="mid"><span class="name">${esc(r.name)}</span><div class="liveline">${meter(e.bus).s}${tag.s}</div></div><div class="end"><span class="t t-26">${big}</span><span class="rel">${sub}</span></div></a>`);
}

/** A campus stop in a list (search, saved): name · chips · nearest bus. */
export function stopRowU(si, opts = {}) {
  const s = U.stops[si];
  const rows = board(si);
  const first = rows.find(r => r.est);
  const shared = U.shared[si];
  const also = shared ? `<span class="dist">Also Connect · ${esc(D.stops[shared.j].name)}</span>` : (opts.dist != null ? `<span class="dist">${esc(opts.dist)}</span>` : '');
  const end = first
    ? `<div class="end"><div class="when">${chip(first.ri, 20).s}<span class="t t-22">${first.est.here ? 'Here' : first.est.stops === null ? first.est.min + ' min' : first.est.stops + (first.est.stops === 1 ? ' stop' : ' stops')}</span></div><span class="rel">${isStale() ? 'at ' + lastSeen() : 'about ' + first.est.min + ' min'}</span>${liveTag(isStale() ? 'Last seen' : 'Live').s}</div>`
    : `<div class="end"><span class="rel">${hasData() ? 'No shuttles running' : 'Live'}</span></div>`;
  return raw(`<a class="stoprow" href="#/usu/${esc(s.id)}"><div class="mid"><span class="name">${esc(s.name)}</span>${also}${chips(s.routes, 24).s}</div>${end}</a>`);
}

export function nearestUSU(lat, lon, n = 4) {
  if (!U) return [];
  return U.stops.map((s, i) => ({ i, d: distance(lat, lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d).slice(0, n);
}
export function searchUSU(q) {
  if (!U) return { stops: [], routes: [] };
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { stops: [], routes: [] };
  const hit = t => words.every(w => t.toLowerCase().includes(w));
  return {
    stops: U.stops.map((s, i) => i).filter(i => hit(U.stops[i].name)),
    routes: U.routes.map((r, i) => i).filter(i => U.routes[i].stops.length && hit(U.routes[i].name)),
  };
}
