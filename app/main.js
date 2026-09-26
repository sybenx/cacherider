// Boot, the hash router, and the pieces every screen shares: the tab bar, the
// desktop header, the location sheet, the minute tick.
import { load, D, BASE, pref, stopIndex, loadAlerts, A } from './data.js';
import { now } from './time.js';
import { html, icon, esc } from './ui.js';
import { loadGrid } from './geo.js';
import * as home from './views/home.js';
import * as stopView from './views/stop.js';
import * as hub from './views/hub.js';
import * as routeView from './views/route.js';
import * as about from './views/about.js';
import * as ustop from './views/ustop.js';
import * as uroute from './views/uroute.js';
import { loadUSU, setWanted, onLive, U } from './usu.js';
import { setRtWanted, onRt } from './rt.js';

const side = document.getElementById('side');
const body = document.getElementById('body');
const TABS = [
  { href: '#/', label: 'Stops', icon: 'stops', match: h => /^#\/(stop|search|route|about|usu|$)/.test(h) },
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

/** The page rises from the bottom over the map. */
function slideIn() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  side.classList.remove('sheet-in'); side.style.transform = 'translateY(100%)';
  void side.offsetHeight;   // commit the start position before the transition begins
  side.classList.add('sheet-in'); side.style.transform = '';
  const done = () => { side.classList.remove('sheet-in'); side.style.transform = ''; };
  side.addEventListener('transitionend', done, { once: true }); setTimeout(done, 400);
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

async function render(tick = false) {
  const { seg, q } = parse();
  renderTabs();
  const name = seg[0] || 'home';
  const clockNow = now();
  let view;
  try {
    if (name === 'home') view = home.render({ q: q.q || '', page: 'home' }, clockNow);
    else if (name === 'search') view = home.render({ q: q.q || '', page: 'search' }, clockNow);
    else if (name === 'stop') view = stopView.render({ id: seg[1], full: seg[2] === 'all' }, clockNow);
    else if (name === 'hub') view = hub.render({ bay: seg[1] }, clockNow);
    else if (name === 'route') view = routeView.render({ short: decodeURIComponent(seg[1] || ''), dir: seg[2] }, clockNow);
    else if (name === 'about') view = about.render({}, clockNow);
    else if (name === 'usu' && seg[1] === 'route') view = uroute.render({ id: seg[2] }, clockNow);
    else if (name === 'usu') view = ustop.render({ id: seg[1] }, clockNow);
    else if (name === 'map') view = null;
    else view = home.render({}, clockNow);
  } catch (e) {
    console.error(e);
    view = { html: html`<div class="empty"><h2>Something went wrong</h2><p>${e.message}</p></div>` };
  }
  // A stop page reached from the Map tab on a phone is a sheet over the map: it slides up, and a swipe down at
  // its top sends it back. The mark survives the minute's redraws of the same page.
  const isPage = name === 'stop' || (name === 'usu' && seg[1] !== 'route');
  const fromMap = !!app.route && app.route.name === 'map' && isPage && !isDesktop();
  app.route = { name, seg, q };
  const mapOpen = name === 'map';
  setWanted(!!(view && view.live) || mapOpen || (isDesktop() && !!U) || (name === 'search' && !!U) || (name === 'home' && !!U));
  setRtWanted(mapOpen || isDesktop() || ['home', 'search', 'stop', 'hub', 'route'].includes(name));
  body.classList.toggle('map-open', mapOpen);
  if (view) {
    const same = side.dataset.view === name + (seg[1] || '');
    const keepScroll = (tick || view.keepScroll) && same;
    const y = side.scrollTop;
    side.innerHTML = view.html;
    side.dataset.view = name + (seg[1] || '');
    side.dataset.sheet = fromMap || (same && isPage && side.dataset.sheet === '1') ? '1' : '';
    side.scrollTop = keepScroll ? y : 0;
    view.mount && view.mount(side, app);
    if (fromMap) slideIn();
  }
  if (mapOpen || isDesktop()) {
    const m = await ensureMap();
    const at = name === 'map' && seg[1] === 'at' && seg[2] ? { lat: +seg[2].split(',')[0], lon: +seg[2].split(',')[1], label: decodeURIComponent(seg[3] || '') } : null;
    const mapU = name === 'map' && seg[1] === 'usu', mapR = name === 'map' && seg[1] === 'route';
    m.show({
      stopId: name === 'map' && !at && !mapU && !mapR ? seg[1] : name === 'stop' ? seg[1] : null,
      ustopId: mapU ? seg[2] : name === 'usu' && seg[1] !== 'route' ? seg[1] : null,
      routeShort: mapR ? decodeURIComponent(seg[2] || '') : name === 'route' ? decodeURIComponent(seg[1] || '') : null,
      at, focus: name === 'map' || name === 'stop' || name === 'usu' || name === 'route', hub: name === 'hub', tick,
    }, app, clockNow);
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

/** Near me: silent when the browser already allows it, the explaining sheet only when the browser is about to ask. */
export async function nearMe(onDone) {
  let state = pref('near') === 'on' ? 'granted' : 'prompt';
  try {
    if (navigator.permissions) state = (await navigator.permissions.query({ name: 'geolocation' })).state;
  } catch { /* the browser won't say; go by what we remember */ }
  if (state === 'granted') return locate(onDone);
  if (state === 'denied') pref('near', 'blocked');
  askLocation(onDone);
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

// ---- install: the browser's own prompt where there is one; on iPhone Safari, the steps, once, on the third day
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function countVisit() {
  const today = new Date().toISOString().slice(0, 10);
  if (pref('lastvisit') === today) return +(pref('visits') || 1);
  pref('lastvisit', today);
  const n = +(pref('visits') || 0) + 1;
  pref('visits', String(n));
  return n;
}
export function installCard() {
  if (!app.installPrompt || standalone() || pref('install')) return '';
  return html`<div class="blueprint install" id="install-card">${html.raw('<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>')}
    <div class="who"><span class="cr">CR</span><div class="col"><span class="title">Install Cache Rider</span><span class="sub">One tap from your home screen. Works offline.</span></div></div>
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

export function iosSheet() {
  const sheet = document.createElement('div');
  sheet.className = 'ios-install';
  sheet.innerHTML = html`<div class="scrim"></div><div class="sheet blueprint" role="dialog" aria-label="Add to Home Screen">${html.raw('<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>')}
    <div class="who"><span class="cr big">CR</span><div class="col"><span class="title">Keep Cache Rider on your home screen</span><span class="sub">Opens full screen on your saved stops. Works offline with the last timetable it downloaded.</span></div><button class="btn btn-ghost btn-icon" data-act="no" aria-label="Close">${icon('close', 22)}</button></div>
    <div class="steps">
      <div class="step"><span class="n">1</span><span>Tap <b>Share</b> in Safari's toolbar</span><span class="ic">${icon('share', 20)}</span></div>
      <div class="step"><span class="n">2</span><span>Choose <b>Add to Home Screen</b></span><span class="ic">${icon('plusSquare', 20)}</span></div>
      <div class="step"><span class="n">3</span><span>Tap <b>Add</b>, top right</span><span class="ic">${icon('check', 20)}</span></div>
    </div>
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
  const visits = countVisit();
  if (isIOS() && !pref('install') && visits >= 3) setTimeout(iosSheet, 1200);
}

/** The look: the phone's by default, or light or dark when the rider picks one; kept on the phone and applied in
 *  index.html before first paint. The toggle steps phone → light → dark → phone, and wears the sun-and-moon, the
 *  sun or the moon to say which it's on. */
export const themeMode = () => document.documentElement.dataset.theme || 'auto';
const THEME = { auto: ['sunmoon', 'Matches your phone'], light: ['sun', 'Light'], dark: ['moon', 'Dark'] };
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
  form.onsubmit = e => { e.preventDefault(); const q = form.querySelector('input').value.trim(); location.hash = q ? '#/search?q=' + encodeURIComponent(q) : '#/'; };
  const near = document.getElementById('topnear');
  near.innerHTML = icon('near', 20).s + 'Near me';
  near.onclick = () => app.geo ? nearOff() : nearMe();
  // Following the phone, a change of its look reaches the maps too.
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode() === 'auto') window.dispatchEvent(new Event('themechange')); });
}

async function boot() {
  try {
    await Promise.all([load(), loadGrid()]);
    await Promise.all([loadUSU(), loadAlerts()]);   // after the timetable: shared kerbs and alerts need its stops and routes
  } catch (e) {
    side.innerHTML = html`<div class="empty"><h2>Couldn't load the timetable</h2><p>${e.message}. Check the connection and pull to refresh.</p></div>`;
    return;
  }
  wireHeader();
  setupInstall();
  wireSheet();
  // Not `render` itself: the event would arrive as the tick flag and the map would sit still.
  window.addEventListener('hashchange', () => render());
  matchMedia('(min-width: 900px)').addEventListener('change', () => render());
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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') return; if (Date.now() - A.loadedAt > 3600e3) loadAlerts().then(() => render()); else render(); });
  // Fresh bus positions redraw a live screen in place.
  onLive(() => { if (app.route && app.route.name !== 'map' && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) render(true); if (app.mapMod) app.mapMod.liveUpdate(app); });
  onRt(() => { if (app.route && app.route.name !== 'map' && !(document.activeElement && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName))) render(true); if (app.mapMod) app.mapMod.liveUpdate(app); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register(BASE + 'sw.js').catch(() => {});
}
boot();
