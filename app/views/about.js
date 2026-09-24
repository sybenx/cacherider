// What this is, where the times come from, and the offline map switch.
import { D, BASE, pref } from '../data.js';
import { fmtDay } from '../time.js';
import { html, icon, corners } from '../ui.js';

export function render(_, clockNow) {
  const built = D.feed.built ? fmtDay(D.feed.built.replace(/-/g, '')) : '';
  return {
    title: 'About',
    html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div>
    <div class="head"><span class="eyebrow">Unofficial</span><h1>Cache Rider</h1></div>
    <div class="pad" style="font-size:16px;line-height:1.5">
      <p>A schedule app for ${D.agency.brand}, the ${D.agency.name} bus. Made by a rider, not by the agency.</p>
      <p>Times come from ${D.agency.brand}'s published GTFS schedule, refreshed nightly${built ? ` (last ${built})` : ''}. Every time is the scheduled one; buses can run early or late.</p>
      <p>Nothing about you leaves this phone. Your location, when you share it, is used only to sort stops by distance. There are no accounts, no analytics and no cookies.</p>
      <p>Add it to your home screen and it works offline: the timetable is kept on the phone, and the map can be too.</p>
    </div>
    <div class="section">${icon('map', 16)}Offline map</div>
    <div class="pad" id="offline"><p class="muted" style="font-size:14px">Keeps the Cache Valley map on this phone, about 10 MB, so it draws with no signal.</p>
      <button class="btn btn-secondary btn-lg blueprint" id="save-map">${corners()}${icon('down', 20)}Save the map for offline</button></div>
    <div class="section">${icon('info', 16)}Feed</div>
    <div class="pad muted" style="font-size:14px"><p>${D.feed.version || ''}</p><p><a href="${D.agency.url}" target="_blank" rel="noopener">${D.agency.url}</a>${D.agency.phone ? ' · ' + D.agency.phone : ''}${D.agency.fares ? html` · <a href="${D.agency.fares}" target="_blank" rel="noopener">fares</a>` : ''}</p>
      <p><a href="https://github.com/sybenx/cacherider" target="_blank" rel="noopener">Source on GitHub</a> · Companion to the <a href="https://github.com/sybenx/headway" target="_blank" rel="noopener">Headway</a> Pebble watchface. Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, via Protomaps.</p></div>
    <div class="fine">Cache Rider isn't affiliated with ${D.agency.name}.</div>`,
    mount,
  };
}

async function mount(el) {
  const btn = el.querySelector('#save-map');
  const status = async () => {
    try {
      const c = await caches.open('cr-map');
      const hit = await c.match(BASE + 'data/cachevalley.pmtiles');
      if (hit) { btn.innerHTML = corners().s + icon('close', 20).s + 'Remove the offline map'; btn.dataset.saved = '1'; }
      else { btn.innerHTML = corners().s + icon('down', 20).s + 'Save the map for offline'; delete btn.dataset.saved; }
    } catch { btn.disabled = true; }
  };
  await status();
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const c = await caches.open('cr-map');
      if (btn.dataset.saved) { await c.delete(BASE + 'data/cachevalley.pmtiles'); }
      else {
        btn.textContent = 'Saving…';
        const r = await fetch(BASE + 'data/cachevalley.pmtiles', { cache: 'no-store' });
        if (!r.ok) throw new Error('map ' + r.status);
        await c.put(BASE + 'data/cachevalley.pmtiles', new Response(await r.arrayBuffer(), { headers: { 'Content-Type': 'application/octet-stream' } }));
      }
    } catch (e) { btn.textContent = "Couldn't save: " + e.message; }
    btn.disabled = false;
    await status();
  };
}
