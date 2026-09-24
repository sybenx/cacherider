// Boot, the hash router, and the pieces every screen shares: the tab bar, the
// desktop header, the location sheet, the minute tick.
import { load, D, BASE, pref, stopIndex } from './data.js';
import { now } from './time.js';
import { html, icon, esc } from './ui.js';
import * as home from './views/home.js';
import * as stopView from './views/stop.js';
import * as hub from './views/hub.js';
import * as routeView from './views/route.js';
import * as about from './views/about.js';

const side = document.getElementById('side');
const body = document.getElementById('body');
const TABS = [
  { href: '#/', label: 'Stops', icon: 'stops', match: h => /^#\/(stop|search|route|about|$)/.test(h) },
  { href: '#/map', label: 'Map', icon: 'map', match: h => h.startsWith('#/map') },
  { href: '#/hub', label: 'Transit Center', icon: 'hub', match: h => h.startsWith('#/hub') },
];

export const app = {
  geo: null,            // { lat, lon, at } once the rider has shared their position
  mapMod: null,         // the map module, once loaded
  route: null,          // current { name, params }
};

function renderTabs() {
  const h = location.hash || '#/';
  for (const id of ['tabs', 'topnav']) {
    document.getElementById(id).innerHTML = TABS.map(t => html`<a href="${t.href}" ${t.match(h) ? html.raw('aria-current="page"') : ''}>${icon(t.icon, id === 'tabs' ? 22 : 18)}${t.label}</a>`).join('');
  }
}

function parse() {
  const h = (location.hash || '#/').slice(1);
  const [path, qs] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  return { seg, q, path };
}

const isDesktop = () => matchMedia('(min-width: 900px)').matches;

async function ensureMap() {
  if (!app.mapMod) app.mapMod = await import('./views/map.js');
  return app.mapMod;
}

async function render(tick = false) {
  const { seg, q } = parse();
  renderTabs();
  const name = seg[0] || 'home';
  const clockNow = now();
  let view;
  try {
    if (name === 'home') view = home.render({ q: q.q || '' }, clockNow);
    else if (name === 'search') view = home.render({ q: q.q || '' }, clockNow);
    else if (name === 'stop') view = stopView.render({ id: seg[1], full: seg[2] === 'all' }, clockNow);
    else if (name === 'hub') view = hub.render({ bay: seg[1] }, clockNow);
    else if (name === 'route') view = routeView.render({ short: decodeURIComponent(seg[1] || ''), dir: seg[2] }, clockNow);
    else if (name === 'about') view = about.render({}, clockNow);
    else if (name === 'map') view = null;
    else view = home.render({}, clockNow);
  } catch (e) {
    console.error(e);
    view = { html: html`<div class="empty"><h2>Something went wrong</h2><p>${e.message}</p></div>` };
  }
  app.route = { name, seg, q };
  const mapOpen = name === 'map';
  body.classList.toggle('map-open', mapOpen);
  if (view) {
    const keepScroll = (tick || view.keepScroll) && side.dataset.view === name + (seg[1] || '');
    const y = side.scrollTop;
    side.innerHTML = view.html;
    side.dataset.view = name + (seg[1] || '');
    side.scrollTop = keepScroll ? y : 0;
    view.mount && view.mount(side, app);
  }
  if (mapOpen || isDesktop()) {
    const m = await ensureMap();
    m.show({ stopId: name === 'map' ? seg[1] : name === 'stop' ? seg[1] : null, focus: name === 'map' || name === 'stop', hub: name === 'hub' }, app, clockNow);
  }
  document.title = (view && view.title ? view.title + ' · ' : '') + 'Cache Rider';
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
      : html`<p>Your browser will ask to share your location. Cache Rider uses it on this phone to list the nearest stops first. It isn't sent anywhere or stored.</p><p class="sub">Search and browsing by route work without it.</p>`}
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
  navigator.geolocation.getCurrentPosition(p => {
    app.geo = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() };
    pref('near', 'on');
    onDone && onDone(app.geo);
    render();
  }, err => {
    pref('near', err.code === err.PERMISSION_DENIED ? 'blocked' : null);
    app.geo = null;
    onDone && onDone(null);
    if (err.code === err.PERMISSION_DENIED) askLocation(onDone);
  }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
}

/** Near me: silent when already allowed, a sheet the first time. */
export function nearMe(onDone) {
  if (pref('near') === 'on') locate(onDone); else askLocation(onDone);
}

/** Near me, off: forget the fix and stop asking. */
export function nearOff() {
  app.geo = null;
  pref('near', null);
  render();
}

/** On load, locate only when the browser says it's already allowed: never a prompt before a tap. */
async function autoLocate() {
  if (pref('near') !== 'on' || !navigator.permissions) return;
  try {
    const st = await navigator.permissions.query({ name: 'geolocation' });
    if (st.state === 'granted') locate();
  } catch { /* the browser won't say; wait for the tap */ }
}

function wireHeader() {
  const form = document.getElementById('topsearch');
  form.querySelector('.lead').innerHTML = icon('search', 20).s;
  form.onsubmit = e => { e.preventDefault(); const q = form.querySelector('input').value.trim(); location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/'; };
  const near = document.getElementById('topnear');
  near.innerHTML = icon('near', 20).s + 'Near me';
  near.onclick = () => app.geo ? nearOff() : nearMe();
}

async function boot() {
  try {
    await load();
  } catch (e) {
    side.innerHTML = html`<div class="empty"><h2>Couldn't load the timetable</h2><p>${e.message}. Check the connection and pull to refresh.</p></div>`;
    return;
  }
  wireHeader();
  window.addEventListener('hashchange', render);
  matchMedia('(min-width: 900px)').addEventListener('change', render);
  render();
  autoLocate();
  // Relative times drift by the minute: redraw when the minute turns, never mid-tap or mid-typing.
  let lastMin = now().min;
  setInterval(() => {
    const m = now().min;
    if (m === lastMin || document.visibilityState !== 'visible' || !app.route || app.route.name === 'map') return;
    if (document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
    lastMin = m;
    render(true);
  }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + 'sw.js').catch(() => {});
}
boot();
