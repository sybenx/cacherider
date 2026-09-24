// The Transit Center: the pulse, the loops, and the bays as a plan a rider can
// tap. Bays sit where they are, projected from the feed's coordinates.
import { D, nextPulse, nextFromHub, nextAt, stop, route, today } from '../data.js';
import { relative, countdown, clockList, fmtDay, dayName, clockText } from '../time.js';
import { html, icon, badge, time, sched, corners, depRow, headsign } from '../ui.js';

export function render({ bay }, clockNow) {
  const H = D.hub;
  const parts = [];
  const bayStop = bay ? D.stopById[bay] : undefined;
  if (bayStop !== undefined) {
    parts.push(html`<div class="backbar"><a class="btn btn-ghost" href="#/hub">${icon('back', 22)}${H.name}</a></div>`);
  } else {
    parts.push(html`<div class="head tight"><span class="eyebrow">${H.address} · ${H.town}</span><h1>${H.name}</h1></div>`);
    parts.push(pulseBlock(clockNow));
    for (const ri of loopRoutes()) {
      const n = nextFromHub(ri, 3, clockNow);
      if (!n.length) continue;
      const then = n.slice(1).filter(t => t.day === n[0].day).map(t => t.min);
      parts.push(html`<a class="row tap" href="#/stop/${stop(n[0].stop).id}">${badge(ri, 36)}<div class="mid"><span class="name">${route(ri).long}</span><span class="sub">${then.length ? 'then ' + clockList(then) : n[0].day ? dayName(n[0].ymd) : sched().s}</span></div><div class="end">${time(n[0].min, 26)}<span class="rel">${relative(n[0], clockNow)}</span></div></a>`);
    }
    parts.push(html`<div class="section between"><span>Bays</span><span class="note">Tap a bay for its next buses</span></div>`);
  }
  parts.push(plan(bayStop));
  if (bayStop !== undefined) {
    const s = stop(bayStop);
    const rs = s.routes;
    const title = rs.length === 1 ? `Route ${route(rs[0]).short} bay` : `Routes ${rs.map(ri => route(ri).short).join(' & ')} bay`;
    const desc = rs.map(ri => route(ri).desc).filter(Boolean).join(' · ').replace(/,\s*/g, ' · ');
    parts.push(html`<div class="bayhead">${badge(rs[0], 44)}<div class="col"><h2>${title}</h2><span class="sub">${desc}</span></div><a class="btn btn-secondary btn-icon" href="#/hub" aria-label="Close">${icon('close', 20)}</a></div>`);
    const next = nextAt(bayStop, 5, clockNow);
    if (!next.length) parts.push(html`<div class="empty"><p>Nothing scheduled from this bay in the next week.</p></div>`);
    else {
      let lastDay = 0;
      const rows = [];
      for (const t of next) {
        if (t.day !== lastDay) { rows.push(html`<div class="dayhead">${fmtDay(t.ymd, true)}</div>`); lastDay = t.day; }
        rows.push(depRow(t, clockNow, { dayShort: true }));
      }
      if (next[0].day !== 0) rows.unshift(html`<div class="dayhead">${fmtDay(next[0].ymd, true)}</div>`);
      parts.push(html`<div class="list">${html.raw(rows.join(''))}</div>`);
    }
  }
  return { html: parts.join(''), mount, title: H.name, keepScroll: true };
}

function mount(el) {
  // The countdown runs by the second while this screen is up.
  const c = el.querySelector('[data-countdown]');
  if (!c) return;
  const dep = +c.dataset.countdown;
  const tick = () => {
    if (!document.body.contains(c)) return clearInterval(iv);
    const n = nowSec();
    const s = dep * 60 - n;
    if (s <= 0) { c.textContent = '0:00'; return; }
    c.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const iv = setInterval(tick, 1000);
  tick();
}
import { now } from '../time.js';
const nowSec = () => { const n = now(); return n.min * 60 + n.sec; };

function loopRoutes() {
  return D.hub.loops || [];
}

function pulseBlock(clockNow) {
  const p = nextPulse(1, clockNow)[0];
  if (!p) {
    const t = today(D.hub.bays[0].stop, clockNow);
    return html`<div class="callout">${icon('moon', 20)}<div><b>No buses today</b><div class="sub">${D.agency.brand} doesn't run on ${dayName(clockNow.ymd)}s.</div></div></div>`;
  }
  const diff = p.min - clockNow.min + p.day * 1440;
  const end = p.day === 0 && diff <= 10
    ? html`<span class="t t-36 count" data-countdown="${p.min}">${countdown(p.min, clockNow)}</span><span class="cap">min : sec</span>`
    : html`<span class="t t-36 count">${p.day === 0 ? diff : ''}</span><span class="cap">${p.day === 0 ? 'min' : relative(p, clockNow)}</span>`;
  return html`<div class="hubpulse"><div class="col"><span class="eyebrow">Next pulse</span>${time(p.min, 56)}<span class="sub">${D.hub.pulseLabel}${p.day === 1 ? ' · tomorrow' : ''}</span></div><div class="end">${end}${sched()}</div></div>`;
}

/** The bay plan: 500 North along the top, the drive as a horseshoe, each bay's badge where the feed puts it. */
function plan(picked) {
  const W = 358, Hh = 300, top = 40, pad = 26;
  const bays = D.hub.bays;
  const lats = bays.map(b => b.lat), lons = bays.map(b => b.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const cos = Math.cos(D.hub.lat * Math.PI / 180);
  const spanX = (maxLon - minLon) * 111000 * cos || 1, spanY = (maxLat - minLat) * 111000 || 1;
  const scale = Math.min((W - 2 * pad) / spanX, (Hh - top - 2 * pad) / spanY);
  const x = lon => pad + (lon - minLon) * 111000 * cos * scale + ((W - 2 * pad) - spanX * scale) / 2;
  const y = lat => top + pad + (maxLat - lat) * 111000 * scale + ((Hh - top - 2 * pad) - spanY * scale) / 2;
  const cx = x((minLon + maxLon) / 2), left = x(minLon), right = x(maxLon), topY = y(maxLat), botY = y(minLat);
  const bar = 20 * scale;
  // Where a rider has drawn the bays (tools/hints.json), that wins over the feed's coordinates.
  const plan = D.hub.plan || {};
  const drawn = plan.bays || {};
  const hallAt = plan.hall_at ? [plan.hall_at[0] * W, plan.hall_at[1] * Hh] : [cx, topY + 50];
  const hallLines = plan.hall || ['HALL'];
  const badgesHtml = bays.map(b => {
    const on = picked === b.stop;
    const id = stop(b.stop).id;
    const at = drawn[route(b.routes[0]).short];
    const stacked = b.routes.length > 2;
    const cols = stacked ? 2 : b.routes.length;
    const half = (cols * 32 - 2) / 2 + 4;
    let bx = at ? at[0] * W : x(b.lon), by = at ? at[1] * Hh : y(b.lat);
    bx = Math.min(Math.max(bx, half), W - half); by = Math.min(Math.max(by, top + 20), Hh - 18);
    const inner = stacked
      ? `<span class="bay-stack">${badge(b.routes[0], 30).s}<span>${b.routes.slice(1).map(ri => badge(ri, 30).s).join('')}</span></span>`
      : b.routes.map(ri => badge(ri, 30).s).join('');
    return `<a class="bay${on ? ' on' : ''}" href="#/hub/${id}" style="left:${bx.toFixed(1)}px;top:${by.toFixed(1)}px" title="Bay: routes ${b.routes.map(ri => route(ri).short).join(', ')}">${inner}</a>`;
  }).join('');
  const hallH = 14 * hallLines.length + 20, hallW = 80;
  const hall = `<rect x="${(hallAt[0] - hallW / 2).toFixed(1)}" y="${(hallAt[1] - hallH / 2).toFixed(1)}" width="${hallW}" height="${hallH}" fill="none" style="stroke:var(--cr-muted)"/>` +
    hallLines.map((l, i) => `<text x="${hallAt[0].toFixed(1)}" y="${(hallAt[1] - hallH / 2 + 10 + 14 * (i + 0.75)).toFixed(1)}" text-anchor="middle" style="font:600 10.5px var(--font-heading);letter-spacing:.1em;fill:var(--cr-muted)">${l.toUpperCase()}</text>`).join('');
  return html.raw(`<div class="bays blueprint${picked !== undefined ? ' picked' : ''}">${corners().s}
    <svg class="plan" viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="${W}" height="${top}" style="fill:color-mix(in srgb, var(--color-text) 8%, transparent)"/>
      <line x1="0" y1="${top}" x2="${W}" y2="${top}" style="stroke:var(--cr-line)"/>
      <text x="12" y="${top * 0.6}" style="font:600 11px var(--font-heading);letter-spacing:.14em;fill:var(--cr-muted)">500 NORTH</text>
      <text x="${W - 12}" y="${top * 0.6}" text-anchor="end" style="font:500 11px var(--font-body);fill:var(--cr-muted)">200 East →</text>
      <path d="M${(left + 2).toFixed(1)} ${(topY + 8).toFixed(1)} Q ${cx.toFixed(1)} ${(botY + (botY - topY) * 1.1).toFixed(1)} ${(right - 2).toFixed(1)} ${(topY + 8).toFixed(1)}" fill="none" style="stroke:color-mix(in srgb, var(--color-text) 9%, transparent)" stroke-width="30"/>
      <path d="M${(left + 2).toFixed(1)} ${(topY + 8).toFixed(1)} Q ${cx.toFixed(1)} ${(botY + (botY - topY) * 1.1).toFixed(1)} ${(right - 2).toFixed(1)} ${(topY + 8).toFixed(1)}" fill="none" style="stroke:var(--cr-line)" stroke-dasharray="4 5"/>
      ${hall}
      <g style="stroke:var(--cr-muted)"><line x1="${W - 22}" y1="${Hh - 84}" x2="${W - 22}" y2="${Hh - 64}"/><path d="M${W - 26} ${Hh - 79} L${W - 22} ${Hh - 85} L${W - 18} ${Hh - 79}" fill="none"/></g>
      <text x="${W - 22}" y="${Hh - 88}" text-anchor="middle" style="font:600 10px var(--font-heading);fill:var(--cr-muted)">N</text>
      <line x1="12" y1="${Hh - 66}" x2="${(12 + bar).toFixed(1)}" y2="${Hh - 66}" style="stroke:var(--cr-muted)"/>
      <text x="12" y="${Hh - 72}" style="font:500 10px var(--font-body);fill:var(--cr-muted)">20 m</text>
    </svg>${badgesHtml}</div>`);
}
