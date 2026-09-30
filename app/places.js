// Saved places: where a rider goes again and again (Home, Work, School, or a name of their own), starred from a
// place's card and kept on this phone only. They're the other end of directions a tap away: in the search before a
// word is typed, among the starts in directions, and 'Take me home' on the home page when there's a Home.
import { html, icon, esc } from './ui.js';

const KEY = 'cr-places';
export const ROLES = ['Home', 'Work', 'School'];   // one of each: saving another asks nothing, it moves
export const placeId = (lat, lon) => (+lat).toFixed(4) + ',' + (+lon).toFixed(4);
export function myPlaces() { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } }
function setPlaces(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode: not kept */ } }
export const placeAt = (lat, lon) => myPlaces().find(p => p.id === placeId(lat, lon)) || null;
export const placeNamed = name => myPlaces().find(p => p.name === name) || null;
/** Saved under a name: a Home saved elsewhere before is that place no longer (its star goes), one of each role. */
export function savePlace(at, name) {
  const id = placeId(at.lat, at.lon);
  const list = myPlaces().filter(p => p.id !== id && !(ROLES.includes(name) && p.name === name));
  list.push({ id, name, lat: +(+at.lat).toFixed(5), lon: +(+at.lon).toFixed(5), label: at.label || '' });
  setPlaces(list);
  dispatchEvent(new Event('placeschange'));
}
export function forgetPlace(id) { setPlaces(myPlaces().filter(p => p.id !== id)); dispatchEvent(new Event('placeschange')); }

/** The star on a place's card: filled when it's saved. */
export function placeStar(at, bare = false) {
  const p = placeAt(at.lat, at.lon);
  return html`<button type="button" class="btn btn-ghost placestar${bare ? ' bare' : ''}" data-place="${JSON.stringify({ lat: at.lat, lon: at.lon, label: at.label || '' })}" aria-pressed="${p ? 'true' : 'false'}" aria-label="${p ? 'Saved as ' + p.name : 'Save place'}" title="${p ? 'Saved as ' + p.name : 'Save place'}">${icon('star', 22, 1.5, p ? 'currentColor' : 'none')}<span>${p ? p.name : 'Save place'}</span></button>`;
}
/** A link's place as it goes to someone else: a saved place's point and name are the sharer's (Home, exactly where),
 *  so it goes as its address, rounded to the street, as 'Share where you are' does. */
export function sharedAs(lat, lon, label) {
  const p = placeAt(lat, lon);
  if (!p) return { lat, lon, label };
  return { lat: Math.round(lat / 0.0005) * 0.0005, lon: Math.round(lon / 0.0005) * 0.0005, label: p.label || 'a place' };
}

let dlg = null;
/** Save as: Home, Work, School, the place's own name, or one typed. Saved already: the same, and Remove. */
export function openSave(at) {
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'sharedlg placedlg';
    document.body.append(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    addEventListener('hashchange', () => dlg.open && dlg.close());
  }
  const was = placeAt(at.lat, at.lon), own = at.label || 'This place';
  const chip = name => {
    const other = ROLES.includes(name) && placeNamed(name), moves = other && other.id !== placeId(at.lat, at.lon);
    return `<button type="button" class="btn ${was && was.name === name ? 'btn-primary' : 'btn-secondary'} pd-name" data-name="${esc(name)}"><span>${esc(name)}</span>${moves ? `<small>instead of ${esc(other.label || 'where it was')}</small>` : ''}</button>`;
  };
  dlg.innerHTML = `<div class="sd-top"><h2>${was ? 'Saved as ' + esc(was.name) : 'Save as'}</h2><button type="button" class="btn btn-ghost btn-icon sd-close" aria-label="Close">${icon('close', 22).s}</button></div>
    <p class="pd-where">${esc(own)}</p>
    <div class="pd-names">${[...ROLES, own].map(chip).join('')}</div>
    <form class="pd-other"><input class="input" name="n" maxlength="30" placeholder="Another name, like Mom's" aria-label="Another name" value="${was && ![...ROLES, own].includes(was.name) ? esc(was.name) : ''}"><button class="btn btn-secondary" type="submit">Save</button></form>
    ${was ? `<button type="button" class="btn btn-ghost pd-forget">Remove from saved places</button>` : ''}
    <p class="fine pd-note">Kept on this phone only.</p>`;
  const done = name => { savePlace(at, name); dlg.close(); };
  dlg.querySelector('.sd-close').onclick = () => dlg.close();
  for (const b of dlg.querySelectorAll('.pd-name')) b.onclick = () => done(b.dataset.name);
  dlg.querySelector('.pd-other').onsubmit = e => { e.preventDefault(); const n = e.target.n.value.trim(); if (n) done(n); };
  const f = dlg.querySelector('.pd-forget');
  if (f) f.onclick = () => { forgetPlace(was.id); dlg.close(); };
  if (!dlg.open) dlg.showModal();
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-place]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  try { openSave(JSON.parse(b.dataset.place)); } catch { /* a malformed place: nothing to save */ }
});
// A star on the screen follows a save or a removal at once.
addEventListener('placeschange', () => {
  for (const b of document.querySelectorAll('[data-place]')) {
    const at = JSON.parse(b.dataset.place), p = placeAt(at.lat, at.lon);
    b.setAttribute('aria-pressed', p ? 'true' : 'false');
    b.innerHTML = icon('star', 22, 1.5, p ? 'currentColor' : 'none').s + `<span>${esc(p ? p.name : 'Save place')}</span>`;
    b.setAttribute('aria-label', p ? 'Saved as ' + p.name : 'Save place'); b.title = b.getAttribute('aria-label');
  }
});
