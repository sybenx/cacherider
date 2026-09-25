// Small HTML helpers: escaping, the route badge, the clock time, the icons.
import { D, route, stop, A, stopAlerts } from './data.js';
import { clock, relative, dayName } from './time.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const part = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(part).join('') : v == null || v === false ? '' : esc(v);
export const html = (strings, ...vals) => new Raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? part(vals[i]) : ''), ''));
export const raw = s => new Raw(s);
html.raw = raw;

const I = {
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  fwd: '<path d="m9 18 6-6-6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  near: '<path d="M2 12h3M19 12h3M12 2v3M12 19v3"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  swap: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  stops: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  map: '<path d="M14.1 6 9 3 3 6v15l6-3 5.1 3L21 18V3z"/><path d="M9 3v15M14.1 6v15"/>',
  hub: '<path d="M8 6v6"/><path d="M15 6v6"/><path d="M2 12h19.6"/><path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C21.1 6.8 20.1 6 19 6H5c-1.1 0-2.1.8-2.4 1.8L1.2 12.8c-.1.4-.2.8-.2 1.2 0 .4.1.8.2 1.2L2 18h3"/><circle cx="7" cy="18" r="2"/><path d="M9 18h5"/><circle cx="16" cy="18" r="2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  share: '<path d="M12 2v13"/><path d="m16 6-4-4-4 4"/><path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2"/>',
  plusSquare: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 12h8M12 8v8"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  install: '<path d="M12 15V3"/><path d="m7 10 5 5 5-5"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
};
export const icon = (name, size = 20, sw = 1.5, fill = 'none') => raw(`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[name]}</svg>`);

/** The route badge in the agency's colour. '16 AM' sets its suffix small, as the design draws it. */
export function badge(ri, size = 36) {
  const r = route(ri);
  const m = /^(\S+)\s+(\S+)$/.exec(r.short);
  const label = m ? esc(m[1]) + '<small>' + esc(m[2]) + '</small>' : esc(r.short);
  return raw(`<span class="badge badge-${size}" style="background:#${r.color};color:#${r.text}" title="${esc(r.long)}">${label}</span>`);
}
export function badges(ris, size = 24, wide = false) {
  return raw(`<div class="badges${wide ? ' wide' : ''}">${ris.map(ri => badge(ri, size).s).join('')}</div>`);
}

/** '8:06 AM' as the heading type, the meridiem small. */
export function time(min, size = 26) {
  const c = clock(min);
  return raw(`<span class="t t-${size}">${c.h}<small>${c.ap}</small></span>`);
}

export const sched = () => raw(`<span class="sched">${icon('clock', 11).s}Scheduled</span>`);
export const corners = () => raw('<i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>');

/** What a departure is headed for: 'to N Logan · CV Hospital', 'Southbound', 'Green Loop'. */
export function headsign(t) {
  const h = D.headsigns[t.h], r = route(t.r);
  if (!h || h === r.long) return r.long;
  if (/^(north|south|east|west)bound$|^(inbound|outbound)$|loop$/i.test(h)) return h;
  return 'to ' + h;
}

/** One departure row: badge · headsign + Scheduled · time + relative. */
export function depRow(t, clockNow, opts = {}) {
  const rel = opts.rel || relative(t, clockNow, opts);
  const sub = opts.sub ? `<span class="sub">${esc(opts.sub)}</span>` : sched().s;
  return raw(`<div class="row${opts.href ? ' tap' : ''}">${badge(t.r, 36).s}<div class="mid"><span class="name">${esc(opts.name || headsign(t))}</span>${sub}</div><div class="end">${time(t.min, 26).s}<span class="rel">${esc(rel)}</span></div></div>`);
}

/** A stop row for the home and search lists, with its next bus on the right. */
export function stopRow(si, next, clockNow, opts = {}) {
  const s = stop(si);
  const end = next
    ? `<div class="end"><div class="when">${badge(next.r, 20).s}${time(next.min, 22).s}</div><span class="rel">${esc(relative(next, clockNow))}</span>${sched().s}</div>`
    : `<div class="end"><span class="rel">${esc(opts.none || 'No service today')}</span></div>`;
  const town = s.town && s.town !== 'Logan' ? `<span class="town">, ${esc(s.town)}</span>` : '';
  const num = s.hub ? '' : 'Stop ' + (s.code || s.id);
  const alert = A.byStop[s.id] && stopAlerts(si, clockNow.ymd).length ? '<span class="alert">Detour</span>' : '';
  const dist = `<span class="dist">${esc([opts.dist, num].filter(Boolean).join(' · '))}${alert ? (opts.dist || num ? ' · ' : '') + alert : ''}</span>`;
  return raw(`<a class="stoprow" href="#/stop/${esc(s.id)}"><div class="mid"><span class="name">${esc(opts.name || s.name)}${town}</span>${dist}${badges(s.routes, 24).s}</div>${end}</a>`);
}

export function stopTitle(si) {
  const s = stop(si);
  return s.town && s.town !== 'Logan' ? s.name + ', ' + s.town : s.name;
}

/** Which side of the road a stop is: the direction its buses mostly run. */
export function side(si) {
  const per = D.times[si] || {};
  const count = {};
  for (const list of Object.values(per)) for (const t of list) {
    const h = D.headsigns[t[2]];
    if (/bound$/i.test(h)) count[h] = (count[h] || 0) + 1;
  }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : '';
}

export const dayWord = (t, clockNow) => t.day === 0 ? '' : t.day === 1 ? 'tomorrow' : dayName(t.ymd);
