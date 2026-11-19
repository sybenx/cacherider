// The holidays' art, as markup and nothing else: no imports, so the app (holiday.js, the map, the stop and Center
// pages) and the design system in Claude Design (.design-sync/pkg) can draw from the one source. Claude Design's
// sketches of 2026-11-19 (cacherider-mockups/holidays-2026-11-19), lifted as drawn. The colours are the art's own in
// either theme, as the Pumpkin Walk's are: a leaf is red whatever the phone is set to.

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

/** The map's dressing for a season (holiday.js), over the map as the Pumpkin Walk's vine is (#pk-deco). */
export const DECO = { thanksgiving: GARLAND };

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

/** A day's card art by season. */
export const DAY_ART = { thanksgiving: THANKSGIVING_ART };
