// What this is, where the times come from, and the offline map switch.
import { D, BASE, pref, A, activeAlerts } from '../data.js';
import { fmtDay, is24 } from '../time.js';
import { html, icon, corners, badges } from '../ui.js';
import { installState, installSheet, app, themeButton, cycleTheme, nearMe, nearOff, toggleClock } from '../main.js';

export function render({ section }, clockNow) {
  const built = D.feed.built ? fmtDay(D.feed.built.replace(/-/g, '')) : '';
  return {
    title: 'About',
    anchor: section === 'alerts' ? 'alerts' : null,   // #/about/alerts lands on the alerts
    html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div>
    <div class="head"><span class="eyebrow">Unofficial</span><h1>Cache Rider</h1></div>
    <div class="pad" style="font-size:16px;line-height:1.5">
      <p>A schedule app for ${D.agency.brand}, the ${D.agency.name} bus. Made by a rider, not by the agency.</p>
      <a class="btn btn-secondary" href="${feedbackHref()}">${icon('mail', 20)}Send feedback</a>
      <p class="muted" style="font-size:13px;margin-top:8px">A wrong time, a stop that isn't where the map says, an idea: it goes to the person who makes this, not to ${D.agency.brand}.</p>
    </div>
    <div class="section">${icon('sliders', 16)}Settings</div>
    <div class="setrows">
      <div class="setrow"><div class="col"><span class="t">Light or dark</span><span class="s">Your phone's, or always light or dark</span></div>${themeButton('theme')}</div>
      <div class="setrow"><div class="col"><span class="t">Clock</span><span class="s">3:10 PM or 15:10</span></div><div class="seg" role="group" aria-label="Clock"><button type="button" data-clock="12" aria-pressed="${is24() ? 'false' : 'true'}">12-hour</button><button type="button" data-clock="24" aria-pressed="${is24() ? 'true' : 'false'}">24-hour</button></div></div>
      <div class="setrow"><div class="col"><span class="t">Location</span><span class="s">${app.geo ? 'On · sorts stops by distance' : 'Off · turn on to sort stops by distance'}</span></div><button class="btn btn-secondary" id="aboutnear" type="button">${app.geo ? 'Turn off' : 'Turn on'}</button></div>
    </div>
    ${installState() === 'installed' ? '' : html`<div class="section">${icon('down', 16)}On your home screen</div>
    <div class="pad" id="install-about">${installBlock()}</div>`}
    ${installState() === 'installed' || !/Android/i.test(navigator.userAgent) ? '' : html`<div class="section">${icon('globe', 16)}Android app</div>
    <div class="pad muted" style="font-size:14px"><p>On an Android phone without Chrome, GrapheneOS say, there's an app: it opens Cache Rider full screen in your own browser, nothing more. <a href="https://github.com/sybenx/cacherider/releases/latest" target="_blank" rel="noopener">Download the APK</a> from the releases, or add <b>sybenx/cacherider</b> to Obtainium to keep it updated.</p></div>`}
    <div class="section">${icon('map', 16)}Offline map</div>
    <div class="pad" id="offline"><p class="muted" style="font-size:14px" id="offline-note">Keeps the whole Cache Valley street map on this phone, so it draws with no signal. Streets you've already looked at are kept anyway.</p>
      <button class="btn btn-secondary btn-lg blueprint" id="save-map">${corners()}${icon('down', 20)}Save the map for offline</button></div>
    <div class="section" id="alerts">${icon('ban', 16)}Service alerts</div>
    ${alertsBlock(clockNow)}
    <div class="section">${icon('info', 16)}About the data</div>
    <div class="pad muted" style="font-size:14px;line-height:1.5">
      <p>Times come from ${D.agency.brand}'s published GTFS schedule, refreshed nightly${built ? ` (last ${built})` : ''}. Once a bus is on the road, ${D.agency.brand}'s own tracker reports where it is and when it expects to reach each stop, and those rows say <b>Live</b> instead of Scheduled. A live time is still a prediction. A bus on a detour shows on the map but can't give stop times, so its route's rows stay Scheduled.</p>
      <p>Nothing about you leaves this phone. Your location, when you share it, is used only to sort stops by distance. There are no accounts, no analytics and no cookies. The live feed reaches the app through a small relay on Cloudflare, because the tracker refuses requests from browsers; the relay carries the feed one way and keeps nothing.</p>
      <p>${D.feed.version || ''}</p><p><a href="${D.agency.url}" target="_blank" rel="noopener">${D.agency.url}</a>${D.agency.phone ? ' · ' + D.agency.phone : ''}${D.agency.fares ? html` · <a href="${D.agency.fares}" target="_blank" rel="noopener">fares</a>` : ''}</p>
      <p><a href="https://github.com/sybenx/cacherider" target="_blank" rel="noopener">Source on GitHub</a> · Companion to the <a href="https://github.com/sybenx/headway" target="_blank" rel="noopener">Headway</a> Pebble watchface. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, via Protomaps.</p></div>
    <div class="fine">Cache Rider isn't affiliated with ${D.agency.name}.</div>`,
    mount,
  };
}

/** An email, from the rider's own mail app: nothing is sent until they send it. The timetable's date comes along,
 *  so a report about a time can be checked against the right one. */
function feedbackHref() {
  const body = `\n\n\n-- \nCache Rider · timetable of ${D.feed.built || 'unknown date'}`;
  return 'mailto:feedback@cacherider.com?subject=' + encodeURIComponent('Cache Rider feedback') + '&body=' + encodeURIComponent(body);
}

function installBlock() {
  // Never in the installed app (the section isn't drawn there). Elsewhere, always a button: large until it's
  // been used once, then small. It raises the browser's own install prompt where there is one (Chrome), else the steps.
  const used = !!pref('install');
  return html`${used ? '' : html`<p class="muted" style="font-size:14px">One tap from your home screen, full screen, and it works offline.</p>`}<button class="btn btn-secondary${used ? '' : ' btn-lg blueprint'}" id="install-go" type="button">${used ? '' : corners()}${icon('install', 20)}Add to home screen</button>`;
}

const MARK = BASE + 'tiles/tiles.json';   // present in the map cache only once every tile is

async function mount(el) {
  const th = el.querySelector('#theme');
  if (th) th.onclick = cycleTheme;
  for (const b of el.querySelectorAll('[data-clock]')) b.onclick = () => { if ((b.dataset.clock === '24') !== is24()) toggleClock(); };
  const nr = el.querySelector('#aboutnear');
  if (nr) nr.onclick = () => app.geo ? nearOff() : nearMe();
  const go = el.querySelector('#install-go');
  if (go) go.onclick = async () => {
    const p = app.installPrompt;
    if (p) {
      p.prompt();
      const r = await p.userChoice.catch(() => null);
      if (r && r.outcome === 'accepted') { pref('install', 'done'); app.installPrompt = null; }
    } else installSheet();
    if (!pref('install')) pref('install', 'seen');   // used once: the button goes small
    const box = el.querySelector('#install-about'); if (box) { box.innerHTML = installBlock().s; mount(el); }
  };
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
  const upd = when ? `Checked ${when.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', hourCycle: is24() ? 'h23' : 'h12' })}` : '';
  if (!al.length) return html`<div class="pad muted" style="font-size:14px"><p>Nothing from ${D.agency.brand} right now. ${upd}</p></div>`;
  return html`<div class="list">${al.map(a => html`<div class="alertrow">${a.ri && a.ri.length ? badges(a.ri, 24) : ''}<b>${a.title}</b><p>${a.text}${a.url ? html` <a href="${a.url}" target="_blank" rel="noopener">More</a>` : ''}</p>${known(a).length ? html`<p class="muted">Stops: ${known(a).map(id => html`<a href="#/stop/${id}">${D.stops[D.stopById[id]].name}</a>`).reduce((acc, x, i) => acc.concat(i ? [' · ', x] : [x]), [])}</p>` : ''}</div>`)}</div><div class="fine">${upd}. Alerts come from ${D.agency.brand}'s rider alerts feed, checked hourly.</div>`;
}
// Stops the alert names that are in the timetable; the others are in its words already.
const known = a => (a.stops || []).filter(id => D.stopById[id] !== undefined);
