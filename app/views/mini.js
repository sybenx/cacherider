// The small map at the top of a stop page on a phone: where the stop is, and a
// tap to open the Map tab there. The desktop has the real map beside the page.
import { html, icon } from '../ui.js';

const desktop = () => matchMedia('(min-width: 900px)').matches;

/** Markup for the slot; `sel` is { stopId }, { ustopId } or { route: short }. */
export function miniSlot(sel) {
  const href = sel.route !== undefined ? '#/map/route/' + encodeURIComponent(sel.route) : sel.uroute ? '#/map/uroute/' + sel.uroute : sel.ustopId ? '#/map/usu/' + sel.ustopId : '#/map/' + sel.stopId;
  return html`<div class="minimap-slot" id="minimap" role="link" tabindex="0" aria-label="Show ${sel.route !== undefined || sel.uroute ? 'this route' : 'this stop'} on the map" data-href="${href}" data-stop="${sel.stopId || ''}" data-ustop="${sel.ustopId || ''}" data-route="${sel.route ?? ''}" data-uroute="${sel.uroute || ''}"><div class="minimap-ph">${icon('map', 20)}</div><span class="minimap-open">${icon('map', 16)}Map</span></div>`;
}

/** Wire the slot and, on a phone, draw the map into it. */
export function mountMini(el) {
  const slot = el.querySelector('#minimap');
  if (!slot || desktop()) return;
  const go = () => { location.hash = slot.dataset.href; };
  slot.onclick = e => { if (!e.target.closest('.maplibregl-ctrl')) go(); };
  slot.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  import('./map.js').then(m => m.mini({ stopId: slot.dataset.stop || null, ustopId: slot.dataset.ustop || null, route: slot.dataset.route || undefined, uroute: slot.dataset.uroute || null }, slot)).catch(e => console.warn('minimap', e));
}
