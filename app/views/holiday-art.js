// The holidays' art, as markup and nothing else: no imports, so the app (holiday.js, the map, the stop and Center
// pages) and the design system in Claude Design (.design-sync/pkg) can draw from the one source. Claude Design's
// sketches of 2026-11-19 (cacherider-mockups/holidays-2026-11-19), lifted as drawn. The colours are the art's own in
// either theme, as the Pumpkin Walk's are: a leaf is red and a bulb is lit whatever the phone is set to.

// ---- Thanksgiving's garland on the map ('Thanksgiving · garland on the map'): a twine swag hung from the bottom of a
// phone's search box (along the top of a wide screen's map), maple and oak leaves in the reds, oranges and golds,
// wheat, an orange gourd and a cream one. One stretch of it, 390 wide (a phone's width, as sketched), repeated the
// width of the map; its twine meets the next stretch's where it's hung. Drawn 10 lower than sketched, so the wheat's
// tips (under the search box on a phone) aren't cut off by the stretch's top.
const wheat = (x, y, r, s) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M0 0V-${s[0]}" stroke="#c89a46" stroke-width="${s[1]}" stroke-linecap="round"/><g fill="#dcae55">${s[2]}</g></g>`;
const GARLAND_STRETCH = `
  <path d="M0 6C46 25 80 30 130 22C170 15 175 12 200 16C240 22 270 32 320 22C346 16 368 8 390 6" stroke="#8a6a43" stroke-width="2" fill="none" stroke-linecap="round"/>
  <path d="M0 8C46 27 80 32 130 24C170 17 175 14 200 18C240 24 270 34 320 24C346 18 368 10 390 8" stroke="#b4925f" stroke-width="1" fill="none" stroke-linecap="round" opacity=".7"/>
  ${wheat(30, 21, 22, [26, 1.3, '<ellipse cx="-2" cy="-10" rx="1.8" ry="3.6" transform="rotate(-25 -2 -10)"/><ellipse cx="2" cy="-13" rx="1.8" ry="3.6" transform="rotate(25 2 -13)"/><ellipse cx="-2" cy="-16" rx="1.8" ry="3.6" transform="rotate(-25 -2 -16)"/><ellipse cx="2" cy="-19" rx="1.8" ry="3.6" transform="rotate(25 2 -19)"/><ellipse cx="0" cy="-24" rx="1.6" ry="3.4"/>'])}
  <use href="#holMaple" x="40" y="18" width="22" height="24" fill="#c8442a" transform="rotate(14 51 30)"/>
  <use href="#holOak" x="66" y="23" width="12" height="26" fill="#a8652d" transform="rotate(-10 72 36)"/>
  <g transform="translate(96 30)"><ellipse cx="0" cy="6" rx="8" ry="7" fill="#e7a53a"/><ellipse cx="0" cy="6" rx="3.5" ry="7" fill="#f0bb52"/><path d="M0 -1C0 -4 2 -6 4 -6" stroke="#5d7a2e" stroke-width="2" fill="none" stroke-linecap="round"/></g>
  <use href="#holMaple" x="112" y="20" width="20" height="22" fill="#e0782c" transform="rotate(-18 122 31)"/>
  <use href="#holMaple" x="146" y="13" width="18" height="20" fill="#d9a03a" transform="rotate(8 155 23)"/>
  ${wheat(176, 13, -14, [22, 1.2, '<ellipse cx="-2" cy="-8" rx="1.6" ry="3.2" transform="rotate(-25 -2 -8)"/><ellipse cx="2" cy="-11" rx="1.6" ry="3.2" transform="rotate(25 2 -11)"/><ellipse cx="-2" cy="-14" rx="1.6" ry="3.2" transform="rotate(-25 -2 -14)"/><ellipse cx="0" cy="-19" rx="1.5" ry="3"/>'])}
  <use href="#holOak" x="190" y="18" width="12" height="26" fill="#8f5a2a" transform="rotate(16 196 31)"/>
  <use href="#holMaple" x="214" y="22" width="24" height="26" fill="#b83a26" transform="rotate(-6 226 35)"/>
  <g transform="translate(252 34)"><path d="M-6 6C-6 0 -3 -2 0 -2C3 -2 6 0 6 6C6 11 3 13 0 13C-3 13 -6 11 -6 6Z" fill="#f2e1a8"/><path d="M0 -2C1 -6 3 -7 5 -7" stroke="#5d7a2e" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M-3 0C-6 4 -6 9 -3 12" stroke="#d9c27e" stroke-width="1" fill="none"/></g>
  <use href="#holMaple" x="268" y="26" width="20" height="22" fill="#e48a2e" transform="rotate(20 278 37)"/>
  <use href="#holOak" x="296" y="22" width="12" height="26" fill="#b0702f" transform="rotate(-18 302 35)"/>
  ${wheat(326, 22, 18, [24, 1.3, '<ellipse cx="-2" cy="-9" rx="1.8" ry="3.4" transform="rotate(-25 -2 -9)"/><ellipse cx="2" cy="-12" rx="1.8" ry="3.4" transform="rotate(25 2 -12)"/><ellipse cx="-2" cy="-15" rx="1.8" ry="3.4" transform="rotate(-25 -2 -15)"/><ellipse cx="2" cy="-18" rx="1.8" ry="3.4" transform="rotate(25 2 -18)"/><ellipse cx="0" cy="-22" rx="1.6" ry="3.2"/>'])}
  <use href="#holMaple" x="338" y="12" width="20" height="22" fill="#c8442a" transform="rotate(-12 348 23)"/>
  <use href="#holMaple" x="368" y="4" width="18" height="20" fill="#d9a03a" transform="rotate(10 377 14)"/>`;
export const GARLAND = `<svg class="hol-swag hol-garland" height="62" overflow="visible" aria-hidden="true"><defs>
  <symbol id="holMaple" viewBox="-11 -11 22 24" overflow="visible"><path d="M0 -10L2.2 -5.2 6.2 -7.4 5 -2.4 10 -2.6 7.2 1 9.4 4.4 3.4 3.4 1 8.4 0 6.6 -1 8.4 -3.4 3.4 -9.4 4.4 -7.2 1 -10 -2.6 -5 -2.4 -6.2 -7.4 -2.2 -5.2Z"/><path d="M0 6.6V12" stroke="#6b4a2b" stroke-width="1.2" fill="none" stroke-linecap="round"/></symbol>
  <symbol id="holOak" viewBox="-6 -12 12 26" overflow="visible"><path d="M0 -11C3 -11 4 -8 3 -7C5 -7 6 -4 4 -3C6 -2 6 1 4 2C6 3 5 6 3 6C4 8 2 10 0 10C-2 10 -4 8 -3 6C-5 6 -6 3 -4 2C-6 1 -6 -2 -4 -3C-6 -4 -5 -7 -3 -7C-4 -8 -3 -11 0 -11Z"/><path d="M0 -9V13" stroke="#6b4a2b" stroke-width="1" fill="none" stroke-linecap="round"/></symbol>
  <pattern id="holGarland" width="390" height="62" patternUnits="userSpaceOnUse"><g transform="translate(0 10)">${GARLAND_STRETCH}</g></pattern>
  </defs><rect width="100%" height="62" fill="url(#holGarland)"/></svg>`;

// ---- Christmas lights on the map ('Christmas · lights on the map, after dark'): old C9 bulbs in red, gold, green and
// blue on a dark wire swagged from the same place, each with a glow round it and a slow twinkle, three beats so no two
// side by side keep time (app.css: none with reduced motion; in the light theme only a soft glow, the dark theme's
// halos as sketched). One stretch is four swags, 344 wide, twelve bulbs; drawn out as elements, not a pattern, so each
// bulb's twinkle is its own, and as many stretches as cover a 4K screen's map.
const GLOW = { r: ['#ff5a4e', '.75'], y: ['#ffd166', '.8'], g: ['#4fe07a', '.7'], b: ['#6cb8ff', '.75'] };
const BULBS = [[20, 18, 8], [46, 22, 0], [72, 16, -8]];   // each swag's three, from where it's hung: across, the bulb's top, its tilt
const lightsStretch = dx => {
  let out = `<path d="M${dx} 10c28 14 58 16 86 2c28 14 58 14 86 -2c28 14 58 16 86 2c28 14 58 14 86 -2" stroke="#2c3a2f" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  for (let s = 0, n = 0; s < 4; s++) for (const [ox, y, rot] of BULBS) {
    const c = 'rygb'[n % 4], x = dx + s * 86 + ox, beat = 'abc'[n % 3];
    out += `<g class="hol-bulb hol-${beat}"><circle class="hol-halo" cx="${x}" cy="${y + 14}" r="14" fill="url(#holGlow${c})"/><use href="#holBulb" x="${x - 5}" y="${y}" width="10" height="16" fill="${GLOW[c][0]}"${rot ? ` transform="rotate(${rot} ${x} ${y + 2})"` : ''}/></g>`;
    n++;
  }
  return out;
};
export const LIGHTS = `<svg class="hol-swag hol-lights" height="52" overflow="visible" aria-hidden="true"><defs>
  ${Object.entries(GLOW).map(([c, [col, op]]) => `<radialGradient id="holGlow${c}"><stop offset="0" stop-color="${col}" stop-opacity="${op}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`).join('')}
  <symbol id="holBulb" viewBox="-5 -3 10 16" overflow="visible"><rect x="-2.4" y="-2.6" width="4.8" height="3.6" rx="1" fill="#3b4a3e"/><path d="M0 1C3.6 1 4.4 5.2 3.6 8.2C2.9 10.8 1.4 12.6 0 12.6C-1.4 12.6 -2.9 10.8 -3.6 8.2C-4.4 5.2 -3.6 1 0 1Z"/><ellipse cx="-1.3" cy="5" rx=".9" ry="2" fill="#fff" opacity=".5"/></symbol>
  </defs>${Array.from({ length: 12 }, (_, i) => lightsStretch(i * 344)).join('')}</svg>`;

/** The map's dressing for a season (holiday.js), over the map as the Pumpkin Walk's vine is (#pk-deco). */
export const DECO = { thanksgiving: GARLAND, christmas: LIGHTS };

// ---- Thanksgiving Day's card ('Thanksgiving · Thursday's stop'): golden hour, the sun going down over the
// Wellsvilles, a bus parked under the Transit Center's roof with a lattice pie on its dash, wheat and a gourd.
export const THANKSGIVING_ART = `<svg class="hol-art" viewBox="0 0 358 190" role="img" aria-label="Golden hour over the Wellsvilles, a bus parked at the Transit Center with a pie on its dash">
<defs>
<linearGradient id="holTgSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6c57a"/><stop offset=".55" stop-color="#f3a35e"/><stop offset="1" stop-color="#e9824b"/></linearGradient>
<radialGradient id="holTgSun"><stop offset="0" stop-color="#fff3c8"/><stop offset=".5" stop-color="#ffe08a" stop-opacity=".9"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
<linearGradient id="holTgGlass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe7b8"/><stop offset="1" stop-color="#e8a868"/></linearGradient>
</defs>
<rect width="358" height="190" fill="url(#holTgSky)"/>
<circle cx="92" cy="96" r="46" fill="url(#holTgSun)"/>
<circle cx="92" cy="96" r="15" fill="#fff1c2"/>
<path d="M0 104L30 86 52 92 78 70 96 78 120 58 140 66 164 52 186 64 214 60 240 74 270 70 300 84 330 80 358 92V190H0Z" fill="#b3657a" opacity=".75"/>
<path d="M0 118L26 106 60 112 90 100 126 108 160 98 200 106 240 98 280 108 320 102 358 110V190H0Z" fill="#8c4f6b"/>
<path d="M0 132C60 126 120 130 180 127C240 124 300 128 358 125V190H0Z" fill="#c9884e"/>
<g opacity=".55" stroke="#a96d3a" stroke-width="1.2" fill="none"><path d="M0 140C80 137 160 139 240 136S330 136 358 135"/><path d="M0 148C90 145 180 147 270 144"/></g>
<rect x="0" y="152" width="358" height="38" fill="#6f6a68"/>
<path d="M0 156H358" stroke="#8a8582" stroke-width="2"/>
<g stroke="#f3e6c8" stroke-width="2" stroke-dasharray="12 10" opacity=".7"><path d="M0 176H358"/></g>
<rect x="150" y="84" width="190" height="7" rx="2" fill="#3c3a40"/>
<g fill="#3c3a40"><rect x="160" y="91" width="4" height="62"/><rect x="326" y="91" width="4" height="62"/></g>
<g transform="translate(176 104)">
<rect x="0" y="0" width="148" height="48" rx="7" fill="#f7f4ee"/>
<rect x="0" y="34" width="148" height="7" fill="#5980a6"/>
<path d="M134 0H141C145 0 148 3 148 7V30H134Z" fill="url(#holTgGlass)"/>
<g fill="#3f4a58" opacity=".85"><rect x="10" y="7" width="22" height="18" rx="2.5"/><rect x="38" y="7" width="22" height="18" rx="2.5"/><rect x="66" y="7" width="22" height="18" rx="2.5"/><rect x="94" y="7" width="22" height="18" rx="2.5"/></g>
<rect x="120" y="7" width="10" height="27" rx="2" fill="#3f4a58" opacity=".85"/>
<g transform="translate(136 27)"><path d="M-1 0A6.5 5 0 0 1 12 0Z" fill="#d88a3c"/><path d="M1 -2.5H10M3 -4H8M2.5 0V-3.5M5.5 0V-4.6M8.5 0V-3.5" stroke="#f4c27a" stroke-width=".9" fill="none" stroke-linecap="round"/><rect x="-1.5" y="0" width="14" height="1.6" rx=".8" fill="#9a6a3e"/></g>
<rect x="142" y="38" width="5" height="3" rx="1" fill="#ffe7a3"/>
<circle cx="28" cy="48" r="8" fill="#2a2a2e"/><circle cx="28" cy="48" r="3.2" fill="#8a8a90"/>
<circle cx="118" cy="48" r="8" fill="#2a2a2e"/><circle cx="118" cy="48" r="3.2" fill="#8a8a90"/>
</g>
<g transform="translate(46 150)"><path d="M0 0V-26" stroke="#c89a46" stroke-width="1.4"/><g fill="#e7c06a"><ellipse cx="-2" cy="-12" rx="2" ry="4" transform="rotate(-25 -2 -12)"/><ellipse cx="2" cy="-16" rx="2" ry="4" transform="rotate(25 2 -16)"/><ellipse cx="-2" cy="-20" rx="2" ry="4" transform="rotate(-25 -2 -20)"/><ellipse cx="0" cy="-25" rx="1.8" ry="3.6"/></g></g>
<g transform="translate(58 152)"><path d="M0 0V-20" stroke="#c89a46" stroke-width="1.3"/><g fill="#e7c06a"><ellipse cx="2" cy="-9" rx="1.8" ry="3.6" transform="rotate(25 2 -9)"/><ellipse cx="-2" cy="-13" rx="1.8" ry="3.6" transform="rotate(-25 -2 -13)"/><ellipse cx="0" cy="-19" rx="1.6" ry="3.2"/></g></g>
<g transform="translate(118 146)"><ellipse cx="0" cy="0" rx="9" ry="7.5" fill="#e7a53a"/><ellipse cx="0" cy="0" rx="3.8" ry="7.5" fill="#f2bb52"/><path d="M0 -7C0 -10 2 -12 4 -12" stroke="#5d7a2e" stroke-width="2" fill="none" stroke-linecap="round"/></g>
<path d="M20 40l2 -6 2 6 -2 -1z M300 30l1.6 -5 1.6 5 -1.6 -.8z" fill="#fff6dc" opacity=".6"/>
</svg>`;

// ---- Christmas Day's card ('Christmas · the 25th's stop'): a snowy night over the snow-capped Wellsvilles, snow
// falling (app.css: still with reduced motion), a lit tree, two buses asleep under the Center's snowy roof, eyes
// closed and z's over them, a wreath on one.
const sleepingBus = (x, wreath) => `<g transform="translate(${x} 106)">
<rect x="0" y="0" width="94" height="46" rx="7" fill="#f7f4ee"/>
<path d="M4 1C16 -4 34 -3 50 -2C66 -3 82 -4 90 1Z" fill="#fff"/>
<rect x="0" y="32" width="94" height="7" fill="#5980a6"/>
<g fill="#3f4a58" opacity=".85"><rect x="8" y="7" width="18" height="17" rx="2.5"/><rect x="30" y="7" width="18" height="17" rx="2.5"/><rect x="52" y="7" width="18" height="17" rx="2.5"/></g>
<rect x="76" y="6" width="14" height="22" rx="2.5" fill="#3f4a58" opacity=".85"/>
<path d="M78 15q2.5 2 5 0M84.5 15q2.5 2 5 0" stroke="#eef2f9" stroke-width="1.2" fill="none" stroke-linecap="round"/>
${wreath ? '<g transform="translate(47 -2)"><circle r="9" fill="none" stroke="#2f7a45" stroke-width="4"/><circle r="9" fill="none" stroke="#3f9a58" stroke-width="1.6" stroke-dasharray="2.4 2.8"/><path d="M-3.4 7.4L0 5.4 3.4 7.4 2.4 11.4 0 9 -2.4 11.4Z" fill="#e2453c"/><circle cx="-5" cy="-6" r="1.3" fill="#e2453c"/><circle cx="6" cy="-3" r="1.3" fill="#ffd166"/></g>' : ''}
<circle cx="20" cy="46" r="7.5" fill="#2a2a2e"/><circle cx="74" cy="46" r="7.5" fill="#2a2a2e"/>
</g>`;
export const CHRISTMAS_ART = `<svg class="hol-art" viewBox="0 0 358 190" role="img" aria-label="A snowy night over the Wellsvilles, two buses asleep under the Transit Center's snowy roof">
<defs>
<linearGradient id="holXmSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16213f"/><stop offset=".7" stop-color="#2b3d6b"/><stop offset="1" stop-color="#4c5f8f"/></linearGradient>
<radialGradient id="holXmWarm"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".7"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>
</defs>
<rect width="358" height="190" fill="url(#holXmSky)"/>
<g fill="#fff6dc"><circle cx="30" cy="20" r="1.2"/><circle cx="86" cy="36" r=".9"/><circle cx="140" cy="14" r="1.3"/><circle cx="204" cy="30" r=".9"/><circle cx="262" cy="12" r="1.2"/><circle cx="322" cy="34" r="1"/></g>
<circle cx="300" cy="40" r="13" fill="#f4efd9"/><circle cx="306" cy="36" r="12" fill="#22305a"/>
<path d="M0 104L30 86 52 92 78 70 96 78 120 58 140 66 164 52 186 64 214 60 240 74 270 70 300 84 330 80 358 92V190H0Z" fill="#3b4a78"/>
<path d="M78 70L88 76 96 78 104 72 112 66 120 58 128 64 140 66 152 58 164 52 174 58 186 64 196 62 186 70 170 64 160 62 150 68 138 72 126 68 118 70 108 78 94 84 82 78Z" fill="#e9eef8"/>
<path d="M0 118L26 106 60 112 90 100 126 108 160 98 200 106 240 98 280 108 320 102 358 110V190H0Z" fill="#2f3c63"/>
<path d="M0 130C60 124 120 128 180 125C240 122 300 126 358 123V190H0Z" fill="#dfe6f2"/>
<rect x="0" y="152" width="358" height="38" fill="#c9d2e2"/>
<path d="M0 156H358" stroke="#eef2f9" stroke-width="3"/>
<circle cx="242" cy="130" r="70" fill="url(#holXmWarm)"/>
<rect x="110" y="84" width="236" height="7" rx="2" fill="#2a2f45"/>
<path d="M106 85C110 78 120 79 130 80C150 76 170 80 190 78C214 76 236 80 256 78C280 76 304 80 324 78C336 77 346 79 350 85Z" fill="#ffffff"/>
<g fill="#2a2f45"><rect x="120" y="91" width="4" height="62"/><rect x="334" y="91" width="4" height="62"/></g>
${sleepingBus(132, false)}${sleepingBus(234, true)}
<g fill="#eef2f9" font-family="Barlow Condensed, system-ui, sans-serif" font-weight="600"><text x="226" y="100" font-size="11">z</text><text x="234" y="92" font-size="13">z</text><text x="330" y="96" font-size="11">z</text><text x="338" y="88" font-size="14">z</text></g>
<g transform="translate(40 152)"><path d="M0 0L-14 0 0 -38 14 0Z" fill="#2f6b43"/><path d="M-10 -12L10 -12 0 -38Z" fill="#3b8152"/><path d="M-8 -22C-2 -19 4 -21 8 -24M-11 -8C-4 -4 4 -6 11 -10" stroke="#ffd166" stroke-width="1.2" fill="none"/><circle cx="0" cy="-39" r="2.4" fill="#ffd166"/><path d="M-14 0C-8 -3 8 -3 14 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>
<g class="hol-snow" fill="#ffffff" opacity=".85"><circle cx="18" cy="60" r="1.6"/><circle cx="58" cy="44" r="1.2"/><circle cx="96" cy="120" r="1.4"/><circle cx="120" cy="30" r="1.8"/><circle cx="170" cy="56" r="1.2"/><circle cx="192" cy="100" r="1.6"/><circle cx="222" cy="24" r="1.3"/><circle cx="250" cy="66" r="1.7"/><circle cx="282" cy="110" r="1.2"/><circle cx="312" cy="58" r="1.5"/><circle cx="344" cy="120" r="1.3"/><circle cx="70" cy="96" r="1.1"/><circle cx="150" cy="140" r="1.4"/></g>
</svg>`;

/** A day's card art by season. */
export const DAY_ART = { thanksgiving: THANKSGIVING_ART, christmas: CHRISTMAS_ART };

// ---- Christmas's small things ('Christmas · the small things').
// A bus on the map wears a wreath at its top right ('Wreath'; 'Wreath, dark' in the dark theme, its berries and bow
// brighter). Both are drawn on each bus; app.css shows the theme's one, in the season only, upright as the map turns.
const wreath = (b1, b2, bow) => `<svg viewBox="-11 -11 22 22.5" aria-hidden="true"><circle r="8" fill="none" stroke="#2f7a45" stroke-width="4"/><circle r="8" fill="none" stroke="#3f9a58" stroke-width="1.6" stroke-dasharray="2.4 2.8"/><circle cx="-4" cy="-5.6" r="1.3" fill="${b1}"/><circle cx="5.2" cy="4.4" r="1.3" fill="${b2}"/><path d="M-3 6.8L0 5 3 6.8 2.2 10.4 0 8.2 -2.2 10.4Z" fill="${bow}"/></svg>`;
export const WREATH = `<i class="hol-wreath" aria-hidden="true"><span class="hol-wl">${wreath('#e2453c', '#e2453c', '#e2453c')}</span><span class="hol-wd">${wreath('#ff5a4e', '#ffd166', '#ff5a4e')}</span></i>`;
// Snow on the Transit Center's bays (the real plan dressed, its badges' shapes and colours as they are): a cap of snow
// along the top of each bay's badge, as sketched on the plan's (44 wide there, the badge's width here).
export const SNOWCAP = '<svg class="hol-cap" viewBox="0 -4 44 7" preserveAspectRatio="none" aria-hidden="true"><path d="M0 2C4 -3 14 -2 22 -1C30 -3 40 -2 44 2V3H0Z" fill="#fff"/></svg>';
// A little tree by the hall's doors, its foot at 0 0, lights on it, standing in a mound of snow. (The sketch's drifts
// sat in its frame's corners; the map has no frame, and pinned to the bays' corners they floated over the streets
// like clouds: the snow on the ground is the banks along the roofs' feet now, map.js snowRoof.)
export const TREE = '<svg class="hol-tree" viewBox="-17 -34 34 37" aria-hidden="true"><path d="M0 0L-12 0 0 -30 12 0Z" fill="#2f6b43"/><path d="M-8 -10L8 -10 0 -30Z" fill="#3b8152"/><circle cx="0" cy="-31" r="2.2" fill="#ffd166"/><circle cx="-4" cy="-6" r="1.4" fill="#e2453c"/><circle cx="5" cy="-14" r="1.4" fill="#6cb8ff"/><circle cx="-2" cy="-19" r="1.3" fill="#ffd166"/><path d="M-16 3C-15 -1 -10 -2 -6 -1C-3 -3 3 -3 6 -1C10 -2 15 -1 16 3Z" fill="#fff"/><path d="M-16 3C-15 -1 -10 -2 -6 -1C-3 -3 3 -3 6 -1C10 -2 15 -1 16 3" fill="none" stroke="#dfe5ee" stroke-width=".8"/></svg>';
