// The Pumpkin Walk's art, as markup and nothing else: no imports, so the page (pumpkin.js) and the design system
// in Claude Design (.design-sync/pkg) draw from the one source. Its colours are its own, the night's, in either theme.

// ---- the art: dusk over the hills, a path, and pumpkins lit along it. Its colours are its own, the night's, in either
// theme: an evening is dark whatever the phone is set to.
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
    <path d="${eyes}" fill="#ffd66b"/><path d="${mouth}" fill="#ffd66b"/>
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

// ---- the map's frame: pumpkin vines up its sides and pumpkins in its corners while the view is up, and on a phone a
// vine along the card's top edge with pumpkins sitting on it. Over the map but under its buttons, search and card,
// and never in the way of a tap (pointer-events: none, in the CSS). Drawn here, nothing to fetch; a first cut.
const LEAF = 'M0 0C2-6 8-10 14-9C18-8 21-5 22-1C24 2 22 6 18 6C19 9 15 11 11 9C8 11 4 9 3 6C1 5 0 3 0 0Z';
const leaf = (x, y, r, s = 1) => `<g transform="translate(${x} ${y}) rotate(${r}) scale(${s})"><path d="${LEAF}" fill="#5c8a33"/><path d="M1 0H17M8 0l4-5M10 0l4 5" stroke="#3f6326" stroke-width=".9" fill="none"/></g>`;
const curl = (x, y, s = 1) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 0c6 1 9 7 5 10s-6-1-3-3" stroke="#7aa443" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
const bloom = (x, y) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map(a => `<ellipse rx="2.2" ry="4" cy="-3.6" transform="rotate(${a})" fill="#f6c443"/>`).join('')}<circle r="1.6" fill="#d98b16"/></g>`;
// One stretch of vine, 40 wide and 180 high, its ends meeting the next's (the stem leaves the top as it enters the foot).
const VINE = `<path d="M12 0C4 30 20 60 12 90C4 120 20 150 12 180" stroke="#4a6b2a" stroke-width="3.2" fill="none" stroke-linecap="round"/>
  ${leaf(15, 34, -28)}${leaf(9, 78, 14, 0.85)}${leaf(16, 122, -18, 0.95)}${leaf(9, 166, 24, 0.7)}${curl(14, 98)}${curl(10, 8, 0.8)}${bloom(26, 56)}`;
const cluster = id => `<svg class="pk-cluster ${id}" viewBox="0 0 130 74">${leaf(14, 58, -150, 1.1)}${leaf(108, 60, -20, 1.05)}${curl(96, 30)}
  ${pumpkin(48, 70, 0.95, 0, 'pkHaloD')}${pumpkin(92, 72, 0.72, 2, 'pkHaloD')}</svg>`;
export const DECO = `<div id="pk-deco" aria-hidden="true">
  <svg class="pk-edge pk-left" width="40" height="100%"><defs>
    <pattern id="pkVineV" width="40" height="180" patternUnits="userSpaceOnUse">${VINE}</pattern>
    <radialGradient id="pkHaloD"><stop offset="0" stop-color="#ffb347" stop-opacity=".5"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
  </defs><rect width="40" height="100%" fill="url(#pkVineV)"/></svg>
  <svg class="pk-edge pk-right" width="40" height="100%"><rect width="40" height="100%" fill="url(#pkVineV)"/></svg>
  ${cluster('pk-tl')}${cluster('pk-br')}
</div>`;
// The card's top edge on a phone: a vine along it, leaves up into the map, and pumpkins sitting on it at each end.
export const PERCH = `<div class="pk-perch" aria-hidden="true"><svg viewBox="0 0 400 46" preserveAspectRatio="xMidYMax meet">
  <defs><radialGradient id="pkHaloP"><stop offset="0" stop-color="#ffb347" stop-opacity=".5"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient></defs>
  <path d="M0 42C40 36 80 46 120 41S200 35 240 41 320 46 360 41 392 38 400 38" stroke="#4a6b2a" stroke-width="3" fill="none" stroke-linecap="round"/>
  ${leaf(118, 40, -112, 0.9)}${leaf(172, 38, -70, 0.8)}${leaf(232, 40, -118, 0.85)}${leaf(286, 41, -66, 0.75)}${curl(150, 36, 0.9)}${curl(262, 36, 0.8)}${bloom(202, 26)}
  ${pumpkin(36, 46, 0.78, 0, 'pkHaloP')}${pumpkin(72, 46, 0.52, 2, 'pkHaloP')}${pumpkin(330, 46, 0.52, 0, 'pkHaloP')}${pumpkin(366, 46, 0.8, 1, 'pkHaloP')}
</svg></div>`;
