// What this is, where the times come from, and the offline map switch.
import { D, BASE, pref, A, activeAlerts } from '../data.js';
import { fmtDay } from '../time.js';
import { html, icon, corners, badges } from '../ui.js';
import { installState, iosSheet, app, theme, setTheme } from '../main.js';

export function render(_, clockNow) {
  const built = D.feed.built ? fmtDay(D.feed.built.replace(/-/g, '')) : '';
  return {
    title: 'About',
    html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div>
    <div class="head"><span class="eyebrow">Unofficial</span><h1>Cache Rider</h1></div>
    <div class="pad" style="font-size:16px;line-height:1.5">
      <p>A schedule app for ${D.agency.brand}, the ${D.agency.name} bus. Made by a rider, not by the agency.</p>
      <p>Times come from ${D.agency.brand}'s published GTFS schedule, refreshed nightly${built ? ` (last ${built})` : ''}. Once a bus is on the road, ${D.agency.brand}'s own tracker reports where it is and when it expects to reach each stop, and those rows say <b>Live</b> instead of Scheduled. A live time is still a prediction. A bus on a detour shows on the map but can't give stop times, so its route's rows stay Scheduled.</p>
      <p>Nothing about you leaves this phone. Your location, when you share it, is used only to sort stops by distance. There are no accounts, no analytics and no cookies. The live feed reaches the app through a small relay on Cloudflare, because the tracker refuses requests from browsers; the relay carries the feed one way and keeps nothing.</p>
      <p>Add it to your home screen and it works offline: the timetable is kept on the phone, and the map can be too.</p>
    </div>
    <div class="section">${icon(theme() === 'dark' ? 'moon' : 'sun', 16)}Appearance</div>
    <div class="pad"><div class="seg" role="group" aria-label="Appearance">${['light', 'dark'].map(t => html`<button class="seg-opt${theme() === t ? ' on' : ''}" type="button" data-theme-pick="${t}" aria-pressed="${theme() === t}">${icon(t === 'dark' ? 'moon' : 'sun', 16)}${t === 'dark' ? 'Dark' : 'Light'}</button>`)}</div></div>
    <div class="section">${icon('down', 16)}On your home screen</div>
    <div class="pad" id="install-about">${installBlock()}</div>
    ${installState() === 'installed' ? '' : html`<div class="section">${icon('globe', 16)}Android app</div>
    <div class="pad muted" style="font-size:14px"><p>On an Android phone without Chrome, GrapheneOS say, there's an app: it opens Cache Rider full screen in your own browser, nothing more. <a href="https://github.com/sybenx/cacherider/releases/latest" target="_blank" rel="noopener">Download the APK</a> from the releases, or add <b>sybenx/cacherider</b> to Obtainium to keep it updated.</p></div>`}
    <div class="section">${icon('map', 16)}Offline map</div>
    <div class="pad" id="offline"><p class="muted" style="font-size:14px" id="offline-note">Keeps the whole Cache Valley street map on this phone, so it draws with no signal. Streets you've already looked at are kept anyway.</p>
      <button class="btn btn-secondary btn-lg blueprint" id="save-map">${corners()}${icon('down', 20)}Save the map for offline</button></div>
    <div class="section" id="alerts">${icon('ban', 16)}Service alerts</div>
    ${alertsBlock(clockNow)}
    <div class="section">${icon('info', 16)}Feed</div>
    <div class="pad muted" style="font-size:14px"><p>${D.feed.version || ''}</p><p><a href="${D.agency.url}" target="_blank" rel="noopener">${D.agency.url}</a>${D.agency.phone ? ' · ' + D.agency.phone : ''}${D.agency.fares ? html` · <a href="${D.agency.fares}" target="_blank" rel="noopener">fares</a>` : ''}</p>
      <p><a href="https://github.com/sybenx/cacherider" target="_blank" rel="noopener">Source on GitHub</a> · Companion to the <a href="https://github.com/sybenx/headway" target="_blank" rel="noopener">Headway</a> Pebble watchface. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, via Protomaps.</p></div>
    <div class="fine">Cache Rider isn't affiliated with ${D.agency.name}.</div>`,
    mount,
  };
}

function installBlock() {
  const st = installState();
  if (st === 'installed') return html`<p class="muted" style="font-size:14px">Cache Rider is on your home screen. It opens full screen and works offline.</p>`;
  if (st === 'prompt') return html`<p class="muted" style="font-size:14px">One tap from your home screen, full screen, works offline.</p><button class="btn btn-secondary btn-lg blueprint" id="install-go">${corners()}${icon('install', 20)}Install Cache Rider</button>`;
  if (st === 'ios') return html`<p class="muted" style="font-size:14px">Safari can keep Cache Rider on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.</p><button class="btn btn-secondary btn-lg blueprint" id="install-ios">${corners()}${icon('share', 20)}Show me the steps</button>`;
  return html`<p class="muted" style="font-size:14px">In Chrome or Edge, the browser's menu offers “Install Cache Rider” or “Add to Home screen”. In Safari on a Mac, File → Add to Dock.</p>`;
}

const MARK = BASE + 'tiles/tiles.json';   // present in the map cache only once every tile is

async function mount(el) {
  for (const b of el.querySelectorAll('[data-theme-pick]')) b.onclick = () => { if (b.dataset.themePick !== theme()) setTheme(b.dataset.themePick); };
  const go = el.querySelector('#install-go');
  if (go) go.onclick = async () => {
    const p = app.installPrompt; if (!p) return;
    p.prompt();
    const r = await p.userChoice.catch(() => null);
    if (r && r.outcome === 'accepted') { pref('install', 'done'); app.installPrompt = null; el.querySelector('#install-about').innerHTML = installBlock().s; }
  };
  const ios = el.querySelector('#install-ios');
  if (ios) ios.onclick = () => { const was = pref('install'); iosSheet(); if (was) pref('install', was); };
  const btn = el.querySelector('#save-map');
  const note = el.querySelector('#offline-note');
  const label = (ic, text) => { btn.innerHTML = corners().s + icon(ic, 20).s + text; };
  const status = async () => {
    try {
      const c = await caches.open('cr-map');
      const all = await c.match(MARK);
      const n = (await c.keys()).length;
      if (all) { label('close', 'Remove the offline map'); btn.dataset.saved = '1'; }
      else { label('down', 'Save the map for offline'); delete btn.dataset.saved; }
      if (n && !all) note.textContent = `${n} map tiles are already on this phone from browsing. Saving fetches the rest.`;
    } catch { btn.disabled = true; }
  };
  await status();
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const c = await caches.open('cr-map');
      if (btn.dataset.saved) {
        for (const k of await c.keys()) await c.delete(k);
      } else {
        const index = await (await fetch(MARK, { cache: 'no-store' })).json();
        const urls = index.tiles.map(t => BASE + 'tiles/' + t + '.pbf');
        let done = 0;
        const have = new Set((await c.keys()).map(r => r.url));
        const todo = urls.filter(u => !have.has(u));
        done = urls.length - todo.length;
        for (let i = 0; i < todo.length; i += 24) {
          await Promise.all(todo.slice(i, i + 24).map(async u => {
            const r = await fetch(u); if (r.ok) await c.put(u, r);
          }));
          done += Math.min(24, todo.length - i);
          btn.textContent = `Saving… ${Math.round(done / urls.length * 100)}%`;
        }
        await c.put(MARK, new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } }));
        note.textContent = `${urls.length} map tiles saved, about ${index.mb} MB.`;
      }
    } catch (e) { note.textContent = "Couldn't save: " + e.message; }
    btn.disabled = false;
    await status();
  };
}

function alertsBlock(clockNow) {
  const al = activeAlerts(clockNow.ymd);
  const when = A.fetched ? new Date(A.fetched) : null;
  const upd = when ? `Checked ${when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : '';
  if (!al.length) return html`<div class="pad muted" style="font-size:14px"><p>Nothing from ${D.agency.brand} right now. ${upd}</p></div>`;
  return html`<div class="list">${al.map(a => html`<div class="alertrow">${a.ri && a.ri.length ? badges(a.ri, 24) : ''}<b>${a.title}</b><p>${a.text}${a.url ? html` <a href="${a.url}" target="_blank" rel="noopener">More</a>` : ''}</p>${known(a).length ? html`<p class="muted">Stops: ${known(a).map(id => html`<a href="#/stop/${id}">${D.stops[D.stopById[id]].name}</a>`).reduce((acc, x, i) => acc.concat(i ? [' · ', x] : [x]), [])}</p>` : ''}</div>`)}</div><div class="fine">${upd}. Alerts come from ${D.agency.brand}'s rider alerts feed, checked hourly.</div>`;
}
// Stops the alert names that are in the timetable; the others are in its words already.
const known = a => (a.stops || []).filter(id => D.stopById[id] !== undefined);
