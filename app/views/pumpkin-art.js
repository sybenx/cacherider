// The Pumpkin Walk's art, as markup and nothing else: no imports, so the page (pumpkin.js) and the design system
// in Claude Design (.design-sync/pkg) draw from the one source. Its colours are its own, the night's, in either theme.

// ---- the art: dusk over the hills, a path, and pumpkins lit along it. Its colours are its own, the night's, in either
// theme: an evening is dark whatever the phone is set to.
/** A pumpkin, its foot at x y: face 0, 1 or 2 carved and lit, 3 plain. */
export function pumpkin(x, y, s, face, halo = 'pkHalo') {
  const eyes = face === 1
    ? 'M-9 -19l3.5-6 3.5 6zM2 -19l3.5-6 3.5 6z'
    : face === 2 ? 'M-9 -21h6v5h-6zM3 -21h6v5h-6z' : 'M-8 -18l2.5-7 2.5 7zM3 -18l2.5-7 2.5 7z';
  const mouth = face === 2
    ? 'M-9 -11q9 7 18 0q-9 3-18 0z'
    : 'M-10 -12q10 8 20 0l-3 1-1.5 3-2-2.5-1.5 3-2-3-1.5 3-2-2.5-1.5 3-2-3z';
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <ellipse cx="0" cy="-12" rx="30" ry="22" fill="url(#${halo})"/>
    <ellipse cx="-11" cy="-13" rx="12" ry="13" fill="#c94a16"/><ellipse cx="11" cy="-13" rx="12" ry="13" fill="#c94a16"/>
    <ellipse cx="-5" cy="-13" rx="10" ry="14" fill="#e8611c"/><ellipse cx="5" cy="-13" rx="10" ry="14" fill="#e8611c"/>
    <ellipse cx="0" cy="-13" rx="7" ry="14.5" fill="#f57a24"/>
    <path d="M0-26c0-4 1.5-7 4.5-8.5" stroke="#4f6b2a" stroke-width="3.2" fill="none" stroke-linecap="round"/>
    ${face === 3 ? '' : `<path d="${eyes}" fill="#ffd66b"/><path d="${mouth}" fill="#ffd66b"/>`}
  </g>`;
}
const STARS = [[24, 18], [61, 34], [96, 12], [140, 28], [182, 10], [231, 24], [258, 8], [297, 30], [338, 14], [372, 26], [120, 46], [210, 44]];
export const ART = `<svg class="pk-art" viewBox="0 0 400 170" preserveAspectRatio="xMidYMax slice" role="img" aria-label="Pumpkins glowing along a path over the hills at dusk">
  <defs>
    <linearGradient id="pkSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a1238"/><stop offset=".55" stop-color="#4a2a5e"/><stop offset=".85" stop-color="#b5532f"/><stop offset="1" stop-color="#e48a3a"/></linearGradient>
    <radialGradient id="pkHalo"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    <mask id="pkMoon"><rect width="400" height="170" fill="#fff"/><circle cx="331" cy="34" r="15" fill="#000"/></mask>
  </defs>
  <rect width="400" height="170" fill="url(#pkSky)"/>
  ${STARS.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 0.9 : 1.4}" fill="#fff6dc" opacity="${i % 2 ? 0.7 : 0.95}"/>`).join('')}
  <circle cx="340" cy="38" r="15" fill="#fff2c4" mask="url(#pkMoon)"/>
  <path d="M0 112C40 96 74 92 112 100s70 2 104-10 78-14 112-4 54 10 72 6V170H0z" fill="#2b1c47"/>
  <path d="M0 132c30-12 66-16 102-8s64 6 98-6 72-14 112-2 64 12 88 4V170H0z" fill="#1d1333"/>
  <g stroke="#140c24" stroke-width="2" stroke-linecap="round" fill="none">
    <path d="M38 126V96m0 12-9-9m9 3 8-10m-8 18 6-5"/><path d="M356 120V88m0 14 9-8m-9 0-8-9m8 20-6-4"/>
  </g>
  <path d="M60 170c26-14 62-22 104-24s88 6 120 0 50-10 66-14l6 6c-16 6-36 12-70 16s-78 0-118 4-66 12-86 12z" fill="#3a2856" opacity=".9"/>
  ${[[92, 151], [150, 145], [212, 147], [272, 143], [330, 135]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#ffd66b"/>`).join('')}
  ${pumpkin(70, 160, 1.15, 0)}${pumpkin(128, 150, 0.8, 2)}${pumpkin(190, 162, 1.3, 1)}${pumpkin(258, 151, 0.85, 0)}${pumpkin(318, 160, 1.05, 2)}
</svg>`;

// ---- the map's dressing (Claude Design's 'F · draped from the search box'): a vine along the bottom of a phone's
// search box, its leaves hanging, a smiling pumpkin and a plain one sitting on it; on a wide screen along the top of
// the map, under the header's search. Both sides of the map and the card are left clear, the route the brightest
// thing on it. Over the map but under its buttons, search and card, never in the way of a tap (pointer-events: none,
// in the CSS), and counted as the map's top, as the search box is (map.js topCover), so nothing's framed under it.
// It was vines up both sides and pumpkins in the corners.
// A pumpkin's leaf: broad, five soft lobes, its stalk at 0 0 and its tip along +x, 20 long and 24 across.
const LEAF = 'M0 0C-2-5 0-11 5-12C7-12 8-10 9-9C11-12 14-12 15-9C16-7 15-6 15-5C19-5 21-2 20 0C21 2 19 5 15 5C15 6 16 7 15 9C14 12 11 12 9 9C8 10 7 12 5 12C0 11-2 5 0 0Z';
const leaf = (x, y, r, s = 1, fill = '#5c8a33') => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="${LEAF}" fill="${fill}"/><path d="M1 0H17M2 0L12-7M2 0L12 7M1 0L5-8M1 0L5 8" stroke="#3f6326" stroke-width=".8" fill="none" stroke-linecap="round"/></g>`;
// A tendril: off the stem and into a coil of two turns, tightening; flip -1 for one turning the other way.
const coil = (x, y, s = 1, flip = 1) => {
  const cx = 9 * flip, cy = 3, end = 2.6 * 2 * Math.PI, pts = [];
  for (let t = 0; t <= end + 1e-9; t += Math.PI / 9) { const r = 5 * (1 - 0.75 * t / end); pts.push(`${(cx + flip * r * Math.sin(t)).toFixed(1)} ${(cy - r * Math.cos(t)).toFixed(1)}`); }
  return `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0Q${4 * flip}-4 ${9 * flip}-2L${pts.join('L')}" stroke="#7aa443" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
};
const bloom = (x, y) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<ellipse rx="2.2" ry="4" cy="-3.6" transform="rotate(${a})" fill="#f6c443"/>`).join('')}<circle r="1.6" fill="#d98b16"/></g>`;
// One stretch of vine, 360 wide and 40 high, its ends meeting the next's, repeated the width of what it runs along:
// the vine about 15 down, looping up round itself twice and down once where the stretches meet, the pumpkins sitting on it (on it, not hanging below: hung,
// they reached 50 px down into the map). Repeated, it doesn't read as lights: those were small round leaves at an even
// beat on a vine that barely bent.
// Where one stretch meets the next: the vine up, round a loop below it and on, the loop no lower than the leaves; drawn
// at the stretch's end and again a stretch back, each showing its own half.
const JOIN = 'M340 7C352 5 366 8 368 14C370 20 362 23 357 19C352 15 358 7 372 6C376 5.5 378 6 380 6.5';
export const DECO = `<div id="pk-deco" aria-hidden="true"><svg class="pk-swag" height="40" overflow="visible"><defs>
  <radialGradient id="pkHaloD"><stop offset="0" stop-color="#ffb347" stop-opacity=".55"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
  <pattern id="pkSwag" width="360" height="40" patternUnits="userSpaceOnUse"><g transform="translate(0 3)">
  <path d="M20 6.5C30 9 44 11 62 12C82 13 100 15 114 12C128 9 134 0 125 1C116 2 118 16 140 13C166 9 190 17 214 12C230 9 246 1 238 0C230 -1 232 15 254 13C280 11 328 9 340 7" stroke="#4a6b2a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  ${[0, -360].map(dx => `<path transform="translate(${dx} 0)" d="${JOIN}" stroke="#4a6b2a" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
  ${coil(46, 11, 0.6, -1)}${coil(176, 13, 0.6)}${coil(296, 11, 0.55, -1)}
  ${leaf(32, 10, 80, 0.62)}${leaf(100, 15, 100, 0.66, '#4d7a2b')}${leaf(152, 12, 75, 0.55)}${leaf(206, 14, 105, 0.64)}${leaf(270, 12, 85, 0.5, '#4d7a2b')}${leaf(318, 10, 95, 0.6)}
  ${bloom(180, 17)}
  ${pumpkin(64, 25, 0.6, 2, 'pkHaloD')}${pumpkin(292, 24, 0.48, 3, 'pkHaloD')}
  </g></pattern></defs><rect width="100%" height="40" fill="url(#pkSwag)"/></svg></div>`;
