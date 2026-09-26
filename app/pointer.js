// The arrow to a stop: how far and which way, turning with the phone. It turns by itself wherever the browser
// shares the compass unasked (Android does; it costs next to nothing). A tap on a tappable one asks for it where
// the browser insists on asking first (an iPhone), and starts the distance following the rider's steps, which
// needs the GPS and so waits to be asked; another tap, or leaving the page, stops that. With no compass at all
// the arrow stays north-up, which is right on a map. Every [data-point] on the page is kept up to date together.
import { bearing, compass8, distance } from './data.js';
import { metres } from './time.js';
import { icon } from './ui.js';

const pt = { app: null, heading: null, listening: false, following: false, fix: null, watch: null };
const asks = () => typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
const here = () => pt.fix || (pt.app && pt.app.geo);

/** The markup: a button where a tap does something (the one big stop on a page), else a plain mark. */
export function pointerMark(lat, lon, g, tap = false) {
  const deg = bearing(g.lat, g.lon, lat, lon);
  const inner = `<i class="needle" style="transform:rotate(${Math.round(deg)}deg)">${icon('pointer', 13).s}</i><span class="pw">${metres(distance(g.lat, g.lon, lat, lon))} ${compass8(deg)}</span>`;
  return tap
    ? `<button class="pointer" type="button" data-point data-tap data-lat="${lat}" data-lon="${lon}" aria-label="Which way to the stop">${inner}</button>`
    : `<span class="pointer" data-point data-lat="${lat}" data-lon="${lon}">${inner}</span>`;
}

function paint() {
  const els = document.querySelectorAll('[data-point]'), g = here();
  if (!els.length || !g) { quiet(); return; }
  const turning = pt.heading !== null;
  for (const b of els) {
    const lat = +b.dataset.lat, lon = +b.dataset.lon, deg = bearing(g.lat, g.lon, lat, lon);
    b.querySelector('.needle').style.transform = `rotate(${Math.round(deg - (turning ? pt.heading : 0))}deg)`;
    b.querySelector('.pw').textContent = metres(distance(g.lat, g.lon, lat, lon)) + ' ' + compass8(deg);
    b.classList.toggle('live', turning);
    if (!('tap' in b.dataset)) continue;
    b.classList.toggle('ask', !turning && asks());   // a quiet button look only where a tap is what it takes
    b.setAttribute('aria-pressed', pt.following ? 'true' : 'false');
    b.title = pt.following ? 'Following you · tap to stop' : !turning && asks() ? 'Tap to point with your phone' : 'Tap to follow as you walk';
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
  for (const b of el.querySelectorAll('[data-tap]')) b.onclick = e => { e.preventDefault(); e.stopPropagation(); tap(); };
  listen();
  paint();
}
