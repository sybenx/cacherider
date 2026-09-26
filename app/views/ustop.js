// A campus shuttle stop: what's on the road, sorted by estimate. Shares a
// page with the Connect stop at the same kerb.
import { D, nextAt, nearest, isSaved, toggleSaved } from '../data.js';
import { dayName, now, metres } from '../time.js';
import { html, icon, badges, depRow, stopRow } from '../ui.js';
import { U, board, liveRow, chips, notice, isStale, hasData, noBuses, lastSeen, live, offNote } from '../usu.js';
import { miniSlot, mountMini } from './mini.js';
import { afterSave } from '../main.js';

export function render({ id }, clockNow) {
  if (!U) return { html: html`<div class="empty"><h2>Shuttle data isn't loaded</h2></div>`, title: 'Shuttle' };
  const si = U.stopById[id];
  if (si === undefined) return { html: html`<div class="backbar"><a class="btn btn-ghost" href="#/">${icon('back', 22)}Stops</a></div><div class="empty"><h2>No such stop</h2></div>`, title: 'Shuttle' };
  const s = U.stops[si];
  const shared = U.shared[si];
  const cs = shared ? D.stops[shared.j] : null;
  const sid = 'u:' + s.id, sv = isSaved(sid);
  const parts = [];
  parts.push(html`<div class="backbar"><a class="btn btn-ghost" href="#/" onclick="if(history.length>1){history.back();return false}">${icon('back', 22)}Stops</a>
    <button class="btn btn-ghost save" id="save" aria-pressed="${sv ? 'true' : 'false'}" data-id="${sid}">${icon('star', 22, 1.5, sv ? 'currentColor' : 'none')}${sv ? 'Saved' : 'Save'}</button></div>`);
  parts.push(miniSlot({ ustopId: s.id }));
  const eyebrow = cs ? `USU shuttle and Connect · ${metres(shared.d)} apart` : `${U.name} · ${s.routes.length} ${s.routes.length === 1 ? 'route' : 'routes'}`;
  parts.push(html`<div class="head"><span class="eyebrow">${eyebrow}</span><h1>${s.name}</h1>${cs ? html`<span class="muted" style="font-size:14px">Connect stop: ${cs.name}</span>` : ''}
    <div class="badges wide">${chips(s.routes, 30)}${cs ? badges(cs.routes, 30, true) : ''}</div></div>`);

  const rows = board(si);
  if (hasData() && noBuses() && !isStale()) {
    parts.push(html`<div class="blueprint nobus"><i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
      <span class="eyebrow">${dayName(clockNow.ymd)}</span><span class="title">No shuttles on the road</span><span class="sub">${U.hours} This page fills in by itself when a bus reports in.</span></div>`);
  } else {
    if (!hasData() && live.error) parts.push(html`<div class="callout">${icon('info', 20)}<div><b>Can't reach the live feed</b><div class="sub">USU's shuttle positions aren't answering. Nothing is wrong with the shuttles themselves; try again in a minute.</div></div></div>`);
    else if (isStale()) parts.push(html`<div class="callout">${icon('info', 20)}<div><b>Live feed hasn't updated in ${Math.round((Date.now() - live.at) / 60000)} min</b><div class="sub">Showing where buses were at ${lastSeen()}. Minutes are hidden until it's back.</div></div></div>`);
    else parts.push(notice());
    if (hasData()) parts.push(html`<div class="list">${rows.map(r => liveRow(r))}</div>`, offNote(s.routes));
    else if (!live.error) parts.push(html`<div class="list">${rows.map(r => html`<div class="row urow"><span class="uchip" style="min-width:36px;height:36px;font-size:17px;background:${U.routes[r.ri].color};color:${U.routes[r.ri].text}">${U.routes[r.ri].short}</span><div class="mid"><span class="name">${U.routes[r.ri].name}</span><span class="sub">Finding the bus…</span></div><span></span></div>`)}</div>`);
  }

  if (cs) {
    const next = nextAt(shared.j, 2, clockNow);
    if (next.length) parts.push(html`<div class="list">${next.map(t => depRow(t, clockNow, { dayShort: true }))}</div>`);
    parts.push(html`<div style="padding:12px 16px"><a class="btn btn-secondary btn-block" style="min-height:48px" href="#/stop/${cs.id}">Connect stop page</a></div>`);
  } else if (hasData() && noBuses()) {
    const near = nearest(s.lat, s.lon, 1)[0];
    if (near) parts.push(html`<div class="section">Nearest Connect stop</div><div class="list">${stopRow(near.i, nextAt(near.i, 1, clockNow)[0], clockNow, { dist: metres(near.d) })}</div>`);
  }
  return { html: parts.join(''), mount, title: s.name, live: true, keepScroll: true };
}

function mount(el) {
  mountMini(el);
  const b = el.querySelector('#save');
  if (!b) return;
  b.onclick = () => {
    const on = toggleSaved(b.dataset.id);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = icon('star', 22, 1.5, on ? 'currentColor' : 'none').s + (on ? 'Saved' : 'Save');
    if (on) afterSave();
  };
}
