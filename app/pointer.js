// The arrow to a stop: how far and which way, turning with the phone. It turns by itself wherever the browser
// shares the compass unasked (Android does; it costs next to nothing). A tap on a tappable one asks for it where
// the browser insists on asking first (an iPhone), and starts the distance following the rider's steps, which
// needs the GPS and so waits to be asked; another tap, or leaving the page, stops that. With no compass at all
// the arrow stays north-up, which is right on a map. Every [data-point] on the page is kept up to date together.
import { bearing, compass8, distance } from './data.js';
import { metres } from './time.js';
import { icon } from './ui.js';

const pt = { app: null, heading: null, listening: false, following: false, fix: null, watch: null };
// Each arrow's angle as last painted, unwrapped: a compass reads 359 then 1, and an angle that follows the shorter
// way round (361, not 1) keeps the CSS transition from spinning the long way. Kept by the stop the arrow points to,
// so a page redrawn (the feed's poll, the minute) draws its arrow where it already was and nothing moves.
const angles = new Map();
const keyOf = (lat, lon) => lat + ',' + lon;
function unwrap(key, deg) {
  const was = angles.get(key);
  if (was === undefined) { angles.set(key, deg); return deg; }
  let d = ((deg - was) % 360 + 540) % 360 - 180;   // the short way round, in (-180, 180]
  const next = was + d;
  angles.set(key, next);
  return next;
}
/** The needle's and ring's transforms for a stop: with the phone's heading when the compass is on. */
function turns(lat, lon, deg) {
  const turning = pt.heading !== null;
  const needle = unwrap(keyOf(lat, lon), deg - (turning ? pt.heading : 0));
  const ring = turning ? unwrap('ring', -pt.heading) : 0;
  if (!turning) angles.delete('ring');
  return { needle: Math.round(needle), ring: Math.round(ring) };
}
const asks = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
const here = () => pt.fix || (pt.app && pt.app.geo);

/** The markup: a button where a tap does something (the one big stop on a page), else a plain mark. */
export function pointerMark(lat, lon, g, tap = false) {
  const deg = bearing(g.lat, g.lon, lat, lon), t = turns(lat, lon, deg);
  const inner = `<i class="needle" style="transform:rotate(${t.needle}deg)">${icon('pointer', 13).s}</i><span class="pw">${metres(distance(g.lat, g.lon, lat, lon))} ${compass8(deg)}</span>`;
  return tap
    ? `<button class="pointer" type="button" data-point data-tap data-lat="${lat}" data-lon="${lon}" aria-label="Which way to the stop">${inner}</button>`
    : `<span class="pointer" data-point data-lat="${lat}" data-lon="${lon}">${inner}</span>`;
}

/** The big one, for the stop a page is about: a compass face whose ring turns to keep north north, a needle
 *  to the stop, the distance and the way beside it. The same [data-point] as the small marks, painted alike. */
export function pointerDial(lat, lon, g, name = '') {
  const deg = bearing(g.lat, g.lon, lat, lon), t = turns(lat, lon, deg);
  const ticks = Array.from({ length: 12 }, (_, i) => `<line x1="50" y1="3" x2="50" y2="${i % 3 ? 7 : 10}" transform="rotate(${i * 30} 50 50)"/>`).join('');
  const ring = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" stroke-width="1.5"/><g stroke="currentColor" stroke-width="1.5">${ticks}</g>
    <text x="50" y="22" text-anchor="middle" font-size="12" font-weight="700" fill="var(--color-accent-700)">N</text><text x="80" y="54" text-anchor="middle" font-size="10" fill="currentColor">E</text><text x="50" y="86" text-anchor="middle" font-size="10" fill="currentColor">S</text><text x="20" y="54" text-anchor="middle" font-size="10" fill="currentColor">W</text></svg>`;
  const needle = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M50 14 59 52 50 46 41 52z" fill="currentColor"/><circle cx="50" cy="50" r="3" fill="currentColor"/></svg>`;
  const href = walkHref(lat, lon, name);
  return `<div class="dial" role="button" tabindex="0" data-point data-tap data-lat="${lat}" data-lon="${lon}" aria-label="Which way to the stop">
    <span class="face"><span class="ring" style="transform:rotate(${t.ring}deg)">${ring}</span><i class="needle" style="transform:rotate(${t.needle}deg)">${needle}</i></span>
    <span class="txt"><b class="pw">${metres(distance(g.lat, g.lon, lat, lon))} ${compass8(deg)}</b><small class="hint">Which way to the stop</small>
    <a class="walk" href="${href}"${/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : ''}>Walk there${icon('fwd', 15).s}</a></span></div>`;
}
/** The phone's own maps app, walking, to the stop: Android's geo: link offers whichever maps app the phone has;
 *  an iPhone gets Apple Maps; anything else, Google Maps in a tab. Sent only by the rider's tap. */
export function walkHref(lat, lon, name) {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return `geo:${lat},${lon}?q=${lat},${lon}(${encodeURIComponent(name || 'Bus stop')})`;
  if (/iPhone|iPad|iPod/.test(ua)) return `https://maps.apple.com/?daddr=${lat},${lon}&dirflg=w`;
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=walking`;
}

function paint() {
  const els = document.querySelectorAll('[data-point]'), g = here();
  if (!els.length || !g) { quiet(); return; }
  const turning = pt.heading !== null;
  for (const b of els) {
    const lat = +b.dataset.lat, lon = +b.dataset.lon, deg = bearing(g.lat, g.lon, lat, lon), t = turns(lat, lon, deg);
    b.querySelector('.needle').style.transform = `rotate(${t.needle}deg)`;
    b.querySelector('.pw').textContent = metres(distance(g.lat, g.lon, lat, lon)) + ' ' + compass8(deg);
    const ring = b.querySelector('.ring');
    if (ring) ring.style.transform = `rotate(${t.ring}deg)`;   // north stays north
    b.classList.toggle('live', turning);
    if (!('tap' in b.dataset)) continue;
    b.classList.toggle('ask', !turning && asks());   // a quiet button look only where a tap is what it takes
    b.setAttribute('aria-pressed', pt.following ? 'true' : 'false');
    b.title = pt.following ? 'Following you · tap to stop' : !turning && asks() ? 'Tap to point with your phone' : turning ? 'Tap to follow as you walk' : 'Turn the phone to point · tap to follow';
    const hint = b.querySelector('.hint');
    if (hint) hint.textContent = b.title;
  }
}
function onTurn(e) {
  const h = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading : e.absolute && e.alpha !== null ? 360 - e.alpha : null;
  if (h === null) return;
  pt.heading = (h + ((screen.orientation && screen.orientation.angle) || 0) + 360) % 360;
  paint();
}
function listen() {
  if (pt.listening) return;
  pt.listening = true;
  window.addEventListener('deviceorientationabsolute', onTurn); window.addEventListener('deviceorientation', onTurn);
}
function quiet() {   // no arrows left on the page: stop everything
  if (!pt.listening && !pt.following) return;
  pt.listening = false; pt.heading = null;
  window.removeEventListener('deviceorientationabsolute', onTurn); window.removeEventListener('deviceorientation', onTurn);
  stopFollowing();
}
async function tap() {
  // An iPhone asks here. Chrome on Android has the same call but may say 'denied' without asking while still
  // sending the events, so its answer isn't trusted.
  if (asks() && pt.heading === null) { try { await DeviceOrientationEvent.requestPermission(); } catch { /* listen regardless */ } listen(); }
  if (pt.following) stopFollowing(); else startFollowing();
  paint();
}
function startFollowing() {
  if (!navigator.geolocation) return;
  pt.following = true;
  pt.watch = navigator.geolocation.watchPosition(p => {
    pt.fix = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() };
    if (pt.app) pt.app.geo = pt.fix;   // the next minute's redraw sorts the stops from here
    paint();
  }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
  document.addEventListener('visibilitychange', stopFollowing, { once: true });
}
function stopFollowing() {
  if (!pt.following) return;
  pt.following = false;
  if (pt.watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(pt.watch);
  pt.watch = null;
  if (document.querySelector('[data-point]')) paint();
}

/** After a page is drawn: its arrows turn, and a tappable one answers taps. */
export function wirePointers(el, app) {
  pt.app = app;
  const els = el.querySelectorAll('[data-point]');
  if (!els.length) return;
  for (const b of el.querySelectorAll('[data-tap]')) {
    b.onclick = e => { if (e.target.closest('a')) return; e.preventDefault(); e.stopPropagation(); tap(); };   // the Walk there link is the maps app's
    b.onkeydown = e => { if (e.target === b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); tap(); } };
  }
  listen();
  paint();
}
