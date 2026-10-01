// Boot, the hash router, and the pieces every screen shares: the tab bar, the
// desktop header, the location sheet, the minute tick.
import { D, load, BASE, pref, loadAlerts, loadPlaces, loadPool, A, distance } from './data.js';
import { now, is24, set24, isKm, setKm, clock, dayFrom, MON_SHORT } from './time.js';
import { html, icon } from './ui.js';
import { loadGrid , loadElevation, spotKey } from './geo.js';
import { WIDE_MQ, isWide } from './wide.js';
import * as home from './views/home.js';
import * as stopView from './views/stop.js';
import * as hub from './views/hub.js';
import * as about from './views/about.js';
import * as ustop from './views/ustop.js';
import * as uroute from './views/uroute.js';
import * as go from './views/go.js';
import { loadUSU, setWanted, onLive, U } from './usu.js';
import { setRtWanted, onRt } from './rt.js';

const side = document.getElementById('side');
const body = document.getElementById('body');
const TABS = [
  { href: '#/', label: 'Stops', icon: 'stops', match: h => /^#\/(stop|search|about|usu|go|$)/.test(h) },
  { href: '#/map', label: 'Map', icon: 'map', match: h => h.startsWith('#/map') },
  { href: '#/hub', label: 'Transit Center', icon: 'hub', match: h => h.startsWith('#/hub') },
];

export const app = {
  installPrompt: null,  // Chrome's deferred beforeinstallprompt, when it offers one
  editSaved: false,     // the home screen's saved list in edit mode
  geo: null,            // { lat, lon, at } once the rider has shared their position
  mapMod: null,         // the map module, once loaded
  route: null,          // current { name, params }
};

function renderTabs() {
  const h = location.hash || '#/';
  // A tap on the Map tab (or, wider, the Map link at the top) while already on the map puts it back to the whole of Logan: the phone's habit for a
  // tab tapped twice. (Set once: the tabs are redrawn on every page.)
  if (!renderTabs.wired) {
    renderTabs.wired = true;
    // The Map tab from the Transit Center, which is the map too, goes back to the map as it was before the Center:
    // the Center's close-up and its turn put away, a tab's place kept. A second tap is the reset.
    const again = e => {
      const a = e.target.closest('a[href="#/map"]'), h = location.hash || '';
      // With a fix, from another tab it's the near view (the reset), not the place the tab was left: done once the
      // Map tab is drawn. Not from the Center, which is the map too: back to the map as it was before it.
      if (a && app.geo && app.mapMod && !h.startsWith('#/map') && !h.startsWith('#/hub')) { app.mapMod.resetView(app, true); return; }
      if (!a || !(h.startsWith('#/map') || h.startsWith('#/hub')) || !app.mapMod) return;
      e.preventDefault();
      if (h.startsWith('#/hub')) { app.mapMod.leaveHub(); location.hash = '#/map'; return; }   // once the Map tab is drawn
      if (h !== '#/map') history.replaceState(null, '', '#/map');
      app.mapMod.resetView(app);
    };
    for (const id of ['tabs', 'topnav']) document.getElementById(id).addEventListener('click', again);
    // The Transit Center tab tapped at the Center: the Center framed again, however far the map has been moved.
    const hubAgain = e => {
      if (!e.target.closest('a[href="#/hub"]') || !(location.hash || '').startsWith('#/hub') || !app.mapMod) return;
      e.preventDefault();
      if (location.hash !== '#/hub') location.hash = '#/hub';   // a route picked on the board: the whole board again
      app.mapMod.hubAgain(app);
    };
    for (const id of ['tabs', 'topnav']) document.getElementById(id).addEventListener('click', hubAgain);
    // The same for the home page beside the map: the wordmark (or the Stops link) tapped while already home.
    // The home view back, the same each time: not the Map tab's second tap, which turns between the town and the near
    // view (tapped over and over, the map flipped between the two).
    const home = e => {
      if (!['', '#', '#/'].includes(location.hash) || !app.mapMod || !isDesktop()) return;
      e.preventDefault();
      app.mapMod.resetView(app, false, null, false, true);
    };
    document.querySelector('.wordmark').addEventListener('click', home);
    document.getElementById('topnav').addEventListener('click', e => { if (e.target.closest('a[href="#/"]')) home(e); });
  }
  for (const id of ['tabs', 'topnav']) {
    document.getElementById(id).innerHTML = TABS.map(t => html`<a href="${t.href}" ${t.match(h) ? html.raw('aria-current="page"') : ''}>${icon(t.icon, id === 'tabs' ? 22 : 18)}${t.label}</a>`).join('');
  }
}

/** A piece of the address as written: a link cut short mid-escape (%E0) is read as it stands, not thrown on. */
const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };

function parse() {
  const h = (location.hash || '#/').slice(1);
  const [path, qs] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  return { seg, q, path };
}

export const isDesktop = isWide;
/** The files past the timetable (search's, the shuttle's, POOL's, walks'), in: the map waits for them. */
let extrasReady = false, extras = null;
/** Wide enough for a page to take the whole width, in columns (the Transit Center). */

async function ensureMap() {
  if (!app.mapMod) app.mapMod = await import('./views/map.js');
  return app.mapMod;
}

/** On a sheet page, a swipe down from the top follows the finger, then goes back to the map's card or springs
 *  home. Claimed on the first move only at the top of the page with the finger heading down, like the map card. */
function wireSheet() {
  let y0 = null, x0 = 0, t0 = 0, claimed = false;
  side.addEventListener('touchstart', e => {
    if (side.dataset.sheet !== '1' || e.touches.length !== 1) { y0 = null; return; }
    y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; t0 = e.timeStamp; claimed = false;
  }, { passive: true });
  side.addEventListener('touchmove', e => {
    if (y0 === null || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - y0, dx = e.touches[0].clientX - x0;
    if (!claimed) {
      if (side.scrollTop > 0 || dy <= 0 || Math.abs(dx) > Math.abs(dy)) { y0 = null; return; }
      claimed = true; side.classList.remove('sheet-in');
    }
    e.preventDefault();
    side.style.transform = `translateY(${Math.max(0, dy)}px)`;
  }, { passive: false });
  const end = e => {
    if (y0 === null) return;
    const dy = (e.changedTouches[0] ? e.changedTouches[0].clientY : y0) - y0, dt = e.timeStamp - t0;
    y0 = null;
    if (!claimed) return;
    side.classList.add('sheet-in');
    if (dy > 70 || (dy > 24 && dy / Math.max(dt, 1) > 0.5)) {
      side.style.transform = 'translateY(100%)';
      const back = () => { side.classList.remove('sheet-in'); side.style.transform = ''; history.back(); };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) back(); else setTimeout(back, 260);
    } else {
      side.style.transform = '';
      side.addEventListener('transitionend', () => side.classList.remove('sheet-in'), { once: true });
    }
  };
  side.addEventListener('touchend', end); side.addEventListener('touchcancel', end);
}

/** Beside the map on a tablet or wider, a page came in from the left: a swipe left follows the finger and sends it
 *  back there, to wherever the rider was, or springs home. Not the tabs' own pages (Stops, the Transit Center),
 *  which have nowhere to go back to. Claimed on the first move only when it's sideways and leftward, and not on the
 *  small map or anything else that drags or scrolls sideways. */
function wireSwipeBack() {
  let x0 = null, y0 = 0, t0 = 0, claimed = false;
  side.addEventListener('touchstart', e => {
    x0 = null;
    if (!isDesktop() || !app.route || ['home', 'hub', 'map'].includes(app.route.name) || e.touches.length !== 1) return;
    if (e.target.closest('.maplibregl-map, input, .hours')) return;
    for (let el = e.target; el && el !== side; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return;
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = e.timeStamp; claimed = false;
  }, { passive: true });
  side.addEventListener('touchmove', e => {
    if (x0 === null || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - x0, dy = e.touches[0].clientY - y0;
    if (!claimed) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (dx >= 0 || Math.abs(dy) > Math.abs(dx)) { x0 = null; return; }
      claimed = true; side.style.transition = 'none';
    }
    e.preventDefault();
    side.style.transform = `translateX(${Math.min(0, dx)}px)`;
  }, { passive: false });
  const end = e => {
    if (x0 === null) return;
    const dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : x0) - x0, dt = e.timeStamp - t0;
    x0 = null;
    if (!claimed) return;
    side.style.transition = ''; side.style.transform = '';
    // Far enough: the page it goes back to is simply there. Not far enough: the panel is back where it was.
    if (-dx > side.offsetWidth * 0.3 || (-dx > 30 && -dx / Math.max(dt, 1) > 0.5)) { if (history.length > 1) history.back(); else location.hash = '#/'; }
  };
  side.addEventListener('touchend', end); side.addEventListener('touchcancel', end);
}

/** Make a drawn page match new markup in place, changing only what differs: text that changed, an attribute that
 *  changed, a row added or gone. Nodes match by position, which holds for a page redrawn from the same template.
 *  The small map's slot keeps its children (the map lives there, put in by the map module). */
export function morph(el, markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup;
  sync(el, tpl.content);
}
function sync(a, b) {
  const ac = [...a.childNodes], bc = [...b.childNodes];
  for (let i = 0; i < Math.max(ac.length, bc.length); i++) {
    const x = ac[i], y = bc[i];
    if (!y) { x.remove(); continue; }
    if (!x) { a.appendChild(y); continue; }
    if (x.nodeType !== y.nodeType || (x.nodeType === 1 && x.tagName !== y.tagName)) { x.replaceWith(y); continue; }
    if (x.nodeType !== 1) { if (x.data !== y.data) x.data = y.data; continue; }
    for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
    for (const at of y.attributes) if (x.getAttribute(at.name) !== at.value) x.setAttribute(at.name, at.value);
    if (x.tagName === 'INPUT' || x.tagName === 'TEXTAREA') continue;   // a box being typed in is left be
    sync(x, y);
  }
}

async function render(tick = false) {
  // The route page is the map's now: an old address lands there, in place of itself in the history.
  if (/^#\/route\//.test(location.hash)) history.replaceState(null, '', location.hash.replace(/^#\/route\//, '#/map/route/'));
  const { seg, q } = parse();
  renderTabs();
  // A route on a wide screen is a page beside the map, as a stop is; on a phone, the Map tab with its stops as the card.
  const routeArgs = seg[0] === 'map' && seg[1] === 'route' ? { short: dec(seg[2] || ''), dir: seg[3], at: seg[4], full: q.all === '1', bus: q.bus } : null;
  // The Transit Center on a phone is the map too, at the Center, the board its card; on a wide screen a page beside it.
  const hubMap = seg[0] === 'hub' && !isDesktop();
  const clockNow = now();
  // Directions: on a wide screen the page beside the map, the way drawn there.
  const goArgs = seg[0] === 'go' ? { to: seg[1], from: seg[2] === 'at' ? undefined : seg[2], at: seg[2] === 'at' && seg[3] ? { lat: +seg[3].split(',')[0], lon: +seg[3].split(',')[1], label: dec(seg[4] || '') } : null } : null;
  // Directions are the map: on a phone, whenever there's a way to draw, the map with it drawn and the ways as its card.
  // Before a start is chosen, or with no way by bus, the page as it is.
  const goJ = goArgs && goArgs.to !== '-' && !isDesktop() ? go.journey({ ...goArgs, t: q.t }, q.plan, clockNow) : null;
  const goMap = !!goJ;
  const name = routeArgs && isDesktop() ? 'route' : hubMap || goMap ? 'map' : seg[0] || 'home';
  let view;
  try {
    if (name === 'home') view = home.render({ q: q.q || '', page: 'home' }, clockNow);
    else if (name === 'search') view = home.render({ q: q.q || '', page: 'search', pick: q.for || '', from: q.from || '' }, clockNow);
    else if (name === 'go') view = go.render({ ...goArgs, plan: q.plan, t: q.t }, clockNow);
    else if (name === 'stop') view = stopView.render({ id: seg[1], full: seg[2] === 'all', run: q.run, on: q.on }, clockNow);
    else if (name === 'hub') view = hub.render({ bay: seg[1] }, clockNow);
    else if (name === 'route') view = (await ensureMap()).routePage(routeArgs, clockNow);
    else if (name === 'about') view = about.render({ section: seg[1] }, clockNow);
    else if (name === 'usu' && seg[1] === 'route') view = uroute.render({ id: seg[2] }, clockNow);
    else if (name === 'usu') view = ustop.render({ id: seg[1] }, clockNow);
    else if (name === 'map') view = null;
    else view = home.render({}, clockNow);
  } catch (e) {
    console.error(e);
    view = { html: html`<div class="empty"><h2>Something went wrong</h2><p>${e.message}</p></div>` };
  }
  // A stop page reached from the Map tab on a phone is a sheet over the map: a swipe down at its top sends it back. The mark survives the minute's redraws of the same page.
  const isPage = name === 'stop' || name === 'usu';   // a stop, a shuttle stop, a shuttle route
  // A stop on a phone or a portrait tablet is the map with the page as its sheet, as a route and the Transit Center
  // are: the address stays the stop's (#/stop/…, #/usu/…), so links, bookmarks and the offline shell are as ever.
  const stopMap = isPage && !isDesktop() && !!view && !!view.mount;
  const fromMap = !!app.route && app.route.name === 'map' && isPage && !isDesktop();
  app.route = { name, seg, q };
  syncHeader(name, q);
  const mapOpen = name === 'map' || stopMap;
  setWanted(!!(view && view.live) || mapOpen || (isDesktop() && !!U) || (name === 'search' && !!U) || (name === 'home' && !!U) || (name === 'go' && !!U));   // directions: the shuttle is in the planner
  setRtWanted(mapOpen || isDesktop() || ['home', 'search', 'stop', 'hub', 'route', 'go'].includes(name));
  body.classList.toggle('map-open', mapOpen);
  if (view && !stopMap) {
    // A page is the same page across its own picks (the Transit Center's routes): `view.key` says so, and the
    // rider's place is kept.
    const key = view.key || name + (seg[1] || '');
    const same = side.dataset.view === key;
    const keepScroll = (tick || view.keepScroll) && same;
    // The same page again with nothing changed (the feed's poll, most of the time): left alone, so nothing blinks.
    const markup = String(view.html), unchanged = tick && same && side.lastHtml === markup;
    const y = side.scrollTop;
    if (!unchanged && same && side.lastHtml) {
      // The same page, redrawn for the minute or the feed: only what differs is touched, so the small map, the
      // compass, the scroll and everything else on screen stay exactly as they were, and nothing blinks.
      morph(side, markup); side.lastHtml = markup;
    } else if (!unchanged) {
      side.innerHTML = markup; side.lastHtml = markup;
    }
    side.dataset.view = key;
    side.dataset.sheet = fromMap || (same && isPage && side.dataset.sheet === '1') ? '1' : '';
    // Written only when it has to move: setting it, even to where it is, stops a phone's fling dead, and the feed
    // redraws a live page every few seconds.
    if (!keepScroll) { if (side.scrollTop) side.scrollTop = 0; } else if (side.scrollTop !== y) side.scrollTop = y;
    // A link to a part of a page (#/about/alerts) lands on it, the first time only: a tick keeps the rider's place.
    if (!keepScroll && view.anchor) { const a = side.querySelector('#' + view.anchor); if (a) a.scrollIntoView({ block: view.anchorBlock || 'start' }); }
    runSheetOf(view);
    if (!unchanged) view.mount && view.mount(side, app);
  } else runSheetOf(view);   // a stop as the map's sheet: its run sheet here too, before the sheet's mount wires it
  // The map is drawn for the Map tab (a phone's stop and its run are the map with a sheet) and beside a wide screen's pages,
  // once the shuttle, places and the rest it draws are in: beside a first page drawn without them, a moment after it.
  // A phone's map page asked for in the moment before they're in (the home page's stop tapped at once) waits for them.
  if (mapOpen && !extrasReady && extras) await extras;
  if ((mapOpen || isDesktop()) && extrasReady) {
    const m = await ensureMap();
    const at = name === 'map' && seg[1] === 'at' && seg[2] ? { lat: +seg[2].split(',')[0], lon: +seg[2].split(',')[1], label: dec(seg[3] || '') } : null;
    const mapU = name === 'map' && seg[1] === 'usu', mapR = name === 'map' && seg[1] === 'route', mapUR = name === 'map' && seg[1] === 'uroute', mapA = name === 'map' && seg[1] === 'alert', mapB = name === 'map' && seg[1] === 'bus';
    const from = name === 'map' && seg[1] === 'from' ? seg[2] || null : null;   // the map asked where the rider will start from, for directions to this stop
    const to = name === 'map' && seg[1] === 'to' ? seg[2] || null : null;   // or where they're going, for directions from this spot
    m.show({
      stopId: name === 'map' && !hubMap && !goMap && !at && !from && !mapU && !mapR && !mapUR && !mapA && !mapB && seg[1] !== 'to' && seg[1] !== 'from' ? seg[1] : name === 'stop' ? seg[1] : null, from, to,
      uRoute: mapUR ? seg[2] : name === 'usu' && seg[1] === 'route' ? seg[2] : null,
      ustopId: mapU ? seg[2] : name === 'usu' && seg[1] !== 'route' ? seg[1] : null,
      campus: mapU && !seg[2],   // the home page's shuttle line: campus, its loops drawn
      routeShort: routeArgs ? routeArgs.short : null, routeArgs,
      alertId: mapA ? seg[2] : null, run: view && view.run, at, focus: name === 'map' || name === 'stop' || name === 'usu' || name === 'route', hub: seg[0] === 'hub', hubPick: seg[0] === 'hub' ? seg[1] || null : null, tick,
      bus: routeArgs ? routeArgs.bus || null : null,   // a route's bus, from its row or a bus card: ringed on the map
      busId: mapB && seg[2] ? dec(seg[2]) : null,   // a bus from the Transit Center's board: it, on its way in
      // Beside a wide screen's directions, the map picks the other end with a click: where from, for directions to a
      // stop or spot; where to, for directions from a spot.
      goPick: isDesktop() && name === 'go' && goArgs && goArgs.to ? goArgs.to !== '-' ? { for: goArgs.to } : goArgs.at ? { to: spotKey(goArgs.at.lat, goArgs.at.lon, goArgs.at.label) } : null : null,
      journey: goMap ? goJ : view && view.journey || null,   // a way from the directions page, drawn
      // A search in the panel beside the map: its first few stops ringed on the map, and its places' spots.
      searchMarks: isDesktop() && name === 'search' && q.q ? searchMarksOf(side) : null,
      page: stopMap ? { key: name + '/' + seg[1] + (seg[2] ? '/' + seg[2] : ''), html: String(view.html), mount: view.mount } : null,   // a stop's page, the map's sheet
    }, app, clockNow);
  }
  document.title = (view && view.title ? view.title + ' · ' : '') + 'Cache Rider';
}

/** The stops and places a search's results start with, as the panel lists them. */
function searchMarksOf(el) {
  const stops = [...new Set([...el.querySelectorAll('a[href^="#/stop/"]')].map(a => a.getAttribute('href').slice(7).split(/[/?]/)[0]))].slice(0, 6);
  const spots = [...el.querySelectorAll('a[href^="#/map/at/"]')].slice(0, 3).map(a => { const [lat, lon] = a.getAttribute('href').split('/')[3].split(','); return { lat: +lat, lon: +lon }; });
  return { stops, spots };
}
/** A run's sheet over the page (a phone's stop): over the map, its list kept where it was scrolled. Redrawn in place,
 *  and not at all when nothing changed: replaced whole, its list lost the finger scrolling it every time the feed came in. */
function runSheetOf(view) {
  let rs = document.getElementById('runsheet');
  if (view && view.sheet) {
    if (!rs) { rs = document.createElement('div'); rs.id = 'runsheet'; body.appendChild(rs); }
    if (rs.lastHtml !== view.sheet) { if (rs.lastHtml) morph(rs, view.sheet); else rs.innerHTML = view.sheet; rs.lastHtml = view.sheet; }
  } else if (rs) rs.remove();
}

// ---- location: asked for in words first, then of the browser
export function askLocation(onDone) {
  const blocked = pref('near') === 'blocked';
  const sheet = document.createElement('div');
  sheet.innerHTML = html`<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true">
    <div class="grip"></div>
    <div class="title">${icon(blocked ? 'ban' : 'near', 26)}<h2>${blocked ? 'Location is blocked' : 'Sort stops by distance?'}</h2></div>
    ${blocked
      ? html`<p>Your browser is refusing to share your location with Cache Rider. Allow it in the site settings for this page, then try again.</p><p class="sub">Search and browsing by route work without it.</p>`
      : html`<p>Your browser will ask to share your location. Cache Rider uses it on this device to list the nearest stops first. It isn't sent anywhere or stored.</p><p class="sub">Search and browsing by route work without it.</p>`}
    <button class="btn btn-primary btn-lg blueprint" data-act="go"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>${blocked ? 'Try again' : 'Use my location'}</button>
    <button class="btn btn-secondary btn-lg" data-act="no">Not now</button>
  </div>`;
  const close = () => sheet.remove();
  sheet.querySelector('.scrim').onclick = close;
  sheet.querySelector('[data-act=no]').onclick = close;
  sheet.querySelector('[data-act=go]').onclick = () => { close(); locate(onDone); };
  body.appendChild(sheet);
}

export function locate(onDone) {
  if (!navigator.geolocation) { pref('near', 'blocked'); onDone && onDone(null); return; }
  let precise = false, answered = false;
  const take = (p, fine) => {
    // The fix's own time, not when it came: a phone without Google's location service (GrapheneOS, in Vanadium) can
    // answer with its last GPS fix, hours old, and indoors find no newer one. It's still the best there is, so it's
    // used, but marked (stale, over 10 min), and said where it's shown: 'Nearest as of 8:14 AM'. Throwing it away left
    // no location at all. A time that can't be right (none, or ahead of the clock) is taken as now.
    const t = p.timestamp > 1.5e12 && p.timestamp < Date.now() + 60000 ? p.timestamp : Date.now();
    if (app.geo && !app.geo.stale && t < app.geo.at) return true;   // older than the one we have: keep ours
    const g = { lat: p.coords.latitude, lon: p.coords.longitude, at: t, acc: p.coords.accuracy, stale: Date.now() - t > 600000 };
    const moved = !app.geo || distance(app.geo.lat, app.geo.lon, g.lat, g.lon) > 30;
    app.geo = g;
    pref('near', 'on');
    pref('lastgeo', JSON.stringify({ lat: g.lat, lon: g.lon, at: g.at, acc: g.acc }));   // on this phone only: the next open starts here
    if (!answered) { answered = true; onDone && onDone(g); }
    if (moved || !fine) render();   // the GPS's fix redraws only where it moves the rider: a page doesn't reshuffle for nothing
    return true;
  };
  // Refused: location off, and the sheet that says how to allow it. Not found (the GPS timing out indoors, or only a
  // stale fix): location stays on, to be tried again, and a place more than 10 minutes old isn't shown as where they
  // are. A timeout had turned it off, and it was never looked for again till a tap.
  const fail = err => {
    if (answered) return;   // the rough fix stands
    const denied = err.code === err.PERMISSION_DENIED;
    if (denied) { pref('near', 'blocked'); app.geo = null; }
    else if (app.geo && Date.now() - app.geo.at > 600000 && !app.geo.stale) { app.geo = { ...app.geo, stale: true }; render(); }   // kept, said as old
    onDone && onDone(denied ? null : app.geo);
    if (denied) askLocation(onDone);
  };
  // Where the rider roughly is, at once: the phone's last fix or the network's, good to a block, so the stops near
  // them show now, not after the GPS has warmed up (seconds, on a phone opened after a while). Only for the page's own
  // sorting: a way asked for from here (onDone) waits for the GPS.
  if (!onDone) navigator.geolocation.getCurrentPosition(p => { if (!precise) take(p, false); }, () => { /* the GPS's, then */ }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 4000 });
  navigator.geolocation.getCurrentPosition(p => { precise = true; take(p, true); }, fail, { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
}

/** Near me: silent when the browser already allows it, the explaining sheet only when the browser is about to ask. */
export async function nearMe(onDone) {
  // A fix from the last two minutes is where the rider is: no browser call, so no prompt.
  if (app.geo && Date.now() - app.geo.at < 120000) { onDone && onDone(app.geo); return; }
  // Allowed before: straight to the browser, without our explaining sheet. (Firefox answers 'prompt' for a
  // permission it has given unless the rider ticked Remember, so its answer isn't trusted here.)
  if (pref('near') === 'on') return locate(onDone);
  let state = 'prompt';
  try {
    if (navigator.permissions) state = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { /* the browser won't say; go by what we remember */ }
  if (state === 'granted') return locate(onDone);
  if (state === 'denied') pref('near', 'blocked');
  askLocation(onDone);
}

/** 12- or 24-hour, from the About page: every time on screen follows at once. */
export function toggleClock() {
  set24(!is24());
  render();
}

/** Miles or kilometres, from the About page: every distance on screen follows at once. */
export function toggleUnits() {
  setKm(!isKm());
  render();
}

/** Near me, off: forget the fix and stop asking. */
export function nearOff() {
  app.geo = null;
  pref('near', null);
  pref('lastgeo', null);
  render();
}

/** On load, and back to the app with the fix gone stale (two minutes: a phone is mostly resumed, not opened, and the
 *  morning's fix at home was the nearest stop at noon at work), locate only when the browser says it's already
 *  allowed: never a prompt before a tap. The rough fix first, then the GPS's, as ever. */
async function autoLocate() {
  if (pref('near') !== 'on' || !navigator.permissions) return;
  if (app.geo && Date.now() - app.geo.at < 120000) return;
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state === 'granted') locate();
    else if (app.geo && app.geo.kept) { app.geo = null; render(); }   // no longer allowed: the kept place isn't where they are
  } catch { /* the browser won't say; wait for the tap */ }
}

// ---- install: the browser's own prompt where there is one; on iPhone Safari, the steps. Either only once the rider
// has saved a stop, the sign they'll be back, and never over a page they're just opening.
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => !/Android/i.test(navigator.userAgent) && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));   // an iPad says it's a Mac with a touchscreen
/** Just after a rider saves a stop, the first time: on iPhone Safari, the home-screen steps (once; Not now is final). */
export function afterSave() {
  if (isIOS() && !standalone() && !pref('install')) setTimeout(iosSheet, 400);
}
export function installCard() {
  if (!app.installPrompt || standalone() || pref('install')) return '';
  return html`<div class="blueprint install" id="install-card">${html.raw('<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>')}
    <div class="who"><img class="cr" src="icons/icon.svg" alt=""><div class="col"><span class="title">Install Cache Rider</span><span class="sub">One tap from your home screen. Works offline.</span></div></div>
    <div class="acts"><button class="btn btn-ghost" data-act="no">Not now</button><button class="btn btn-primary blueprint" data-act="go">${html.raw('<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>')}${icon('install', 18)}Install</button></div></div>`;
}
export function wireInstall(el) {
  const card = el.querySelector('#install-card');
  if (!card) return;
  card.querySelector('[data-act=no]').onclick = () => { pref('install', 'no'); card.remove(); };
  card.querySelector('[data-act=go]').onclick = async () => {
    const p = app.installPrompt; if (!p) return;
    p.prompt();
    const r = await p.userChoice.catch(() => null);
    if (r && r.outcome === 'accepted') pref('install', 'done');
    app.installPrompt = null; card.remove();
  };
}
/** What the About page can offer: Chrome's prompt, the iPhone steps, or nothing because it's already installed. */
export function installState() {
  if (standalone()) return 'installed';
  if (app.installPrompt) return 'prompt';
  if (isIOS()) return 'ios';
  return 'none';
}

/** The steps for a browser with no install prompt a page can raise: Safari's Share, or a menu elsewhere. */
export function iosSheet() { installSheet(true); }
export function installSheet(ios = isIOS()) {
  const android = /Android/i.test(navigator.userAgent);
  const steps = ios
    ? [['Tap <b>Share</b> in Safari\'s toolbar', 'share'], ['Choose <b>Add to Home Screen</b>', 'plusSquare'], ['Tap <b>Add</b>, top right', 'check']]
    : android
      ? [['Open your browser\'s <b>menu</b> (⋮)', 'more'], ['Choose <b>Install</b> or <b>Add to Home screen</b>', 'plusSquare'], ['Confirm', 'check']]
      : [['Open your browser\'s <b>menu</b>', 'more'], ['Choose <b>Install Cache Rider</b> (Safari: <b>File → Add to Dock</b>)', 'plusSquare'], ['Confirm', 'check']];
  const sheet = document.createElement('div');
  sheet.className = 'ios-install';
  sheet.innerHTML = html`<div class="scrim"></div><div class="sheet blueprint" role="dialog" aria-label="Add to Home Screen">${html.raw('<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>')}
    <div class="who"><img class="cr big" src="icons/icon.svg" alt=""><div class="col"><span class="title">Keep Cache Rider on your home screen</span><span class="sub">Opens full screen on your saved stops. Works offline with the last timetable it downloaded.</span></div><button class="btn btn-ghost btn-icon" data-act="no" aria-label="Close">${icon('close', 22)}</button></div>
    <div class="steps">${html.raw(steps.map(([t, ic], i) => `<div class="step"><span class="n">${i + 1}</span><span>${t}</span><span class="ic">${icon(ic, 20).s}</span></div>`).join(''))}</div>
    <button class="btn btn-secondary btn-lg btn-block" data-act="no">Not now</button></div>`;
  const close = () => { pref('install', 'no'); sheet.remove(); };
  sheet.querySelectorAll('[data-act=no]').forEach(b => b.onclick = close);
  sheet.querySelector('.scrim').onclick = close;
  body.appendChild(sheet);
}
function setupInstall() {
  if (standalone()) return;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); app.installPrompt = e; if (app.route && app.route.name === 'home') render(); });
  window.addEventListener('appinstalled', () => { pref('install', 'done'); app.installPrompt = null; const c = document.getElementById('install-card'); if (c) c.remove(); });
}

/** The look: the phone's by default, or light or dark when the rider picks one; kept on the phone and applied in
 *  index.html before first paint. The toggle steps phone → light → dark → phone, and wears the sun-and-moon, the
 *  sun or the moon to say which it's on. */
export const themeMode = () => document.documentElement.dataset.theme || 'auto';
const THEME = { auto: ['sunmoon', 'Matches this device'], light: ['sun', 'Light'], dark: ['moon', 'Dark'] };
export function cycleTheme() {
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[themeMode()];
  if (next === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
  pref('theme', next === 'auto' ? null : next);
  const dark = next === 'dark' || next === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches;
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.content = dark ? '#101214' : '#f2f2f3';
  window.dispatchEvent(new Event('themechange'));
  paintThemeButtons();
}
export function themeButton(id) {
  const [ic, label] = THEME[themeMode()];
  return html`<button class="btn btn-secondary themebtn" id="${id}" type="button" title="${label}">${icon(ic, 20)}<span>${label}</span></button>`;
}
function paintThemeButtons() {
  const [ic, label] = THEME[themeMode()];
  for (const b of document.querySelectorAll('.themebtn')) { b.innerHTML = icon(ic, 20).s + '<span>' + label + '</span>'; b.title = label; }
}

function wireHeader() {
  const form = document.getElementById('topsearch');
  form.querySelector('.lead').innerHTML = icon('search', 20).s;
  const input = form.querySelector('input');
  // On the Map tab the header's box searches the map, results over it, as the phone's map bar does.
  const onMap = () => app.route && app.route.name === 'map' && app.mapMod;
  // Off it, the one search on a wide screen: its results live in the panel as it's typed in (the panel's own boxes are
  // hidden), no Enter needed. The first keystroke off the search page is a step in the history, so Back and a
  // cleared box go back to where it was; the rest replace it.
  let t;
  input.addEventListener('input', () => {
    if (onMap()) return app.mapMod.mapSearch(input.value);
    if (!isDesktop()) return;
    clearTimeout(t); const was = location.hash; t = setTimeout(() => { if (location.hash === was) panelSearch(input.value); }, 250);   // a result tapped meanwhile is where the rider went
  });
  input.addEventListener('focus', () => { if (onMap() && input.value.trim()) app.mapMod.mapSearch(input.value); });
  form.onsubmit = e => { e.preventDefault(); if (onMap()) return; clearTimeout(t); panelSearch(input.value); };
  // Following the phone, a change of its look reaches the maps too.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode() === 'auto') window.dispatchEvent(new Event('themechange')); });
}
let searchFrom = null;   // where the header's search was started from, off the search page
function panelSearch(v) {
  const q = v.trim(), { seg, q: params } = parse(), onSearch = seg[0] === 'search';
  // Picking one end of a journey on the search page: the pick goes on with whatever's typed.
  const keep = onSearch ? ['for', 'from'].filter(k => params[k]).map(k => k + '=' + encodeURIComponent(params[k])).join('&') : '';
  const target = q ? '#/search?q=' + encodeURIComponent(q) + (keep ? '&' + keep : '') : keep ? '#/search?' + keep : null;
  if (!target) {   // cleared: back to where it was started from
    if (onSearch && searchFrom !== null) { searchFrom = null; history.back(); } else if (onSearch) location.hash = '#/';
    return;
  }
  if (!onSearch) { searchFrom = location.hash || '#/'; location.hash = target; return; }
  if (location.hash !== target) { history.replaceState(null, '', target); window.dispatchEvent(new HashChangeEvent('hashchange')); }
}
/** The header's box on a wide screen follows the page: the search's words on the search page (arriving there, the box
 *  is where to type), empty on any other but the Map tab's, which keeps its own. Not while it's being typed in. */
let syncedName = null;
function syncHeader(name, q) {
  const input = document.querySelector('#topsearch input');
  if (!input || !isDesktop()) return;
  if (name !== 'search') searchFrom = name === 'map' ? searchFrom : null;
  const moved = name !== syncedName;
  syncedName = name;
  if (document.activeElement === input && (name === 'search' || !moved)) return;   // being typed in
  if (name === 'search') { input.value = q.q || ''; if (!q.q) input.focus({ preventScroll: true }); }
  else if (name !== 'map') input.value = '';
}

/** Whether the first page answers from the timetable alone, the rest coming after it: the home page, and beside a wide
 *  screen's map a stop and the Transit Center too (the map waits for the rest instead). A phone's stop and the
 *  Center are the map with a sheet, and search, directions and the shuttle need the rest to say anything. */
function lightFirst() {
  const h = location.hash || '#/';
  return ['#', '#/'].includes(h) || isDesktop() && /^#\/(stop\/|hub(\/|$))/.test(h);
}

/** On a desktop, the panel's badges and stop rows under the pointer lit on the map beside it: a route's badge its line, a
 *  shuttle's chip its loop, a stop's row the stop and its routes. The map's own lines light their badges back (map.js). */
function wireHover() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  let last = null;
  const over = e => {
    if (!isDesktop() || !app.mapMod) return;
    const b = e.target.closest('[data-r], [data-u], a.stoprow[href^="#/stop/"]');
    if (b === last) return;
    last = b;
    if (!b) return app.mapMod.hover();
    if (b.dataset.r !== undefined) return app.mapMod.hover({ rs: [+b.dataset.r] });
    if (b.dataset.u !== undefined) return app.mapMod.hover({ us: [b.dataset.u] });
    const id = decodeURIComponent((b.getAttribute('href') || '').replace(/^#\/stop\//, '').split(/[/?]/)[0]), si = D.stopById[id];
    app.mapMod.hover(si === undefined ? {} : { stop: id, rs: D.stops[si].routes });
  };
  side.addEventListener('mouseover', over);
  side.addEventListener('mouseleave', () => { last = null; if (app.mapMod) app.mapMod.hover(); });
}

async function boot() {
  // Detours seen from the buses: ?detours=off in the address turns them off on this phone, ?detours on again.
  try { const q = new URLSearchParams(location.search); if (q.has('detours')) pref('detours', q.get('detours') === 'off' ? 'off' : null); } catch { /* no address to read */ }
  // The first page asks only for the timetable and the alerts file, both kept on the phone: never the relay, never the
  // files for search, the shuttle, POOL and walks, which follow it.
  try {
    await Promise.all([load(), loadAlerts({ relay: false })]);
    extras = Promise.all([loadGrid(), loadUSU(), loadPlaces(), loadPool(), loadElevation()]).catch(() => {}).then(() => { extrasReady = true; });   // the lie of the land, for timing walks; shared kerbs need the timetable's stops
    if (!lightFirst()) await extras;
  } catch (e) {
    side.innerHTML = html`<div class="empty"><h2>Couldn't load the timetable</h2><p>${e.message}. Check the connection and pull to refresh.</p></div>`;
    return;
  }
  wireHeader();
  setupInstall();
  wireSheet();
  wireSwipeBack();
  wireHover();
  // Not `render` itself: the event would arrive as the tick flag and the map would sit still.
  window.addEventListener('hashchange', () => render());
  matchMedia(WIDE_MQ).addEventListener('change', () => render());
  // Opened with location on: the last place found stands until the new fix comes (or doesn't, and it's said as old),
  // rather than a page without location for the seconds the GPS takes: opened at the Transit Center, its card at once.
  if (pref('near') === 'on' && !app.geo) try { const g = JSON.parse(pref('lastgeo') || 'null'); if (g && isFinite(g.lat) && isFinite(g.lon)) app.geo = { ...g, stale: false, kept: true }; } catch { /* none kept */ }
  render();
  autoLocate();
  // The rest in, the page again with it (a saved shuttle stop, the map beside a wide screen); then the relay's alerts,
  // fresher than the file by up to an hour, the page again if they say something new.
  extras.then(() => render()).then(() => loadAlerts()).then(() => render());
  // The map built out of sight once the first page is up (on a phone most pages are the map), so its first tap
  // doesn't wait on it; after the page's own work, whenever the phone has a moment.
  extras.then(() => (window.requestIdleCallback || (f => setTimeout(f, 300)))(() => ensureMap().then(m => m.warm(app)), { timeout: 1500 }));
  // The day and time at the right of the desktop header: to the minute, as the buses run.
  const tc = document.getElementById('topclock');
  const tick = () => {
    if (!isDesktop() || document.visibilityState !== 'visible') return;
    const c = now(), d = dayFrom(c.ymd), k = clock(c.min);
    tc.innerHTML = html`<span>${d.date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} <span class="md">${MON_SHORT[d.date.getUTCMonth()]} ${d.date.getUTCDate()}</span></span><span class="hm">${k.h}${k.ap ? html`<small>${k.ap}</small>` : ''}</span>`;
  };
  tick(); setInterval(tick, 5000);
  // Relative times drift by the minute: redraw when the minute turns, never mid-tap or mid-typing.
  let lastMin = now().min;
  setInterval(() => {
    const m = now().min;
    if (m === lastMin || document.visibilityState !== 'visible' || !app.route) return;   // the Map tab too: its cards count down
    if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    lastMin = m;
    render(true);
  }, 5000);
  window.addEventListener('seenchange', () => render());   // the detours seen from the buses, traced along the streets
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') return; autoLocate(); if (Date.now() - A.loadedAt > 600e3) loadAlerts().then(() => render()); else render(); });
  setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - A.loadedAt > 600e3) loadAlerts().then(() => render()); }, 60e3);   // a notice posted while the app is open shows within minutes
  // Fresh bus positions redraw a live screen in place.
  onLive(() => { if (app.route && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) render(true); if (app.mapMod) app.mapMod.liveUpdate(app); });
  onRt(() => { if (app.route && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) render(true); if (app.mapMod) app.mapMod.liveUpdate(app); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + 'sw.js').then(reg => {
    // A new worker taking over means what's running is the old app: the page is served from what the phone keeps,
    // so even a fresh load is the last version until the new one is in. A quiet bar offers a reload. Not on the very
    // first visit, when there was no worker and the page came from the network. The check runs on coming back to the
    // app and hourly, since the browser's own only runs on a navigation.
    const hadWorker = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadWorker) updateBar(); });
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 3600e3);
  }).catch(() => {});
}
/** 'Cache Rider has updated', with a reload: once, above the tabs. */
/** A new version has taken over: a strip in the layout, above the tabs (a wide screen's bottom edge), the page and
 *  the map drawn smaller to make room, so it covers nothing. Put away with its ×, it comes back with the next update. */
function updateBar() {
  if (document.querySelector('.updatebar')) return;
  const bar = document.createElement('div');
  bar.className = 'updatebar'; bar.setAttribute('role', 'status');
  bar.innerHTML = html`<span>Cache Rider has updated</span><button class="btn btn-primary" type="button" data-reload>Reload</button><button class="btn btn-ghost btn-icon" type="button" data-close aria-label="Not now">${icon('close', 20)}</button>`;
  const fit = () => window.dispatchEvent(new Event('resize'));   // the map measures its new room
  bar.querySelector('[data-reload]').onclick = () => location.reload();
  bar.querySelector('[data-close]').onclick = () => { bar.remove(); fit(); };
  document.getElementById('tabs').before(bar);
  fit();
}
boot();
