// Route lines on the light map: the feed's colours, sunk where they're too pale to see, and where that leaves two
// alike (8's light olive and the Green Loop's lime, both sunk to near one green), the darker of the two darker still.
// Worked out from the colours, nothing picked by hand; the badges keep the feed's own colours (they're what's on the
// bus). The dark map lifts its own the other way (lift, map.js). Pure: colours in, colours out.

const LAND = [0xef, 0xee, 0xea].map(x => x / 255);   // the light basemap's land, about
const MIN_CONTRAST = 3;   // a thin line reads at 3:1, as a graphic does (WCAG's non-text contrast)
const CLOSE = 0.1;        // two lines nearer than this in OKLab read as one route on a map with both on it
const MAX_CONTRAST = 7;   // as far as the darker of a pair is taken, before its hue is turned instead
const STEP = 3, MAX_TURN = 30;   // degrees of hue a pair is turned apart by, a step at a time, and at most

const hexRGB = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const rgbHex = v => '#' + v.map(x => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
const lin = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const gam = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const lum = v => { const [r, g, b] = v.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
function oklab(v) {
  const [r, g, b] = v.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s].map(gam);
}
const dist = (a, b) => Math.hypot(...oklab(a).map((x, i) => x - oklab(b)[i]));
/** Darkened toward black, hue kept, just to a contrast on the light land (a line needs 3:1). */
function sink(v, to = MIN_CONTRAST) {
  let t = 0, w = v;
  while (contrast(w, LAND) < to && t < 0.9) { t += 0.01; w = v.map(x => x * (1 - t)); }
  return w;
}
/** Its hue turned by `deg` in OKLCH, lightness and chroma kept (then sunk again, should the turn have paled it). */
function turn(v, deg) {
  const [L, a, b] = oklab(v), C = Math.hypot(a, b), h = Math.atan2(b, a) + deg * Math.PI / 180;
  return sink(fromOklab([L, C * Math.cos(h), C * Math.sin(h)]));
}

/** For each route, { color: 'RRGGBB' }: its line's colour on the light map, as a Map from the feed's colour (upper
 *  case, no #) to '#rrggbb'. A pair that comes out closer than CLOSE, one of them sunk here (a pair alike in the feed,
 *  9 and 11, is left alike, as on the dark map), is parted by taking the feed's darker of the two darker, a quarter step of contrast at a
 *  time, to MAX_CONTRAST; still alike, their hues are turned apart, each its own way. */
export function lightInks(routes) {
  const own = routes.map(r => hexRGB('#' + r.color)), ink = own.map(v => sink(v)), sunk = ink.map((v, k) => v !== own[k] && contrast(own[k], LAND) < MIN_CONTRAST);
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    if (routes[i].color.toUpperCase() === routes[j].color.toUpperCase() || !(sunk[i] || sunk[j]) || dist(ink[i], ink[j]) >= CLOSE) continue;
    const dk = lum(own[i]) <= lum(own[j]) ? i : j;   // the darker in the feed goes darker (8, not the Green Loop): the paler keeps what it can
    for (let c = contrast(ink[dk], LAND) + 0.25; c <= MAX_CONTRAST && dist(ink[i], ink[j]) < CLOSE; c += 0.25) ink[dk] = sink(own[dk], c);
    if (dist(ink[i], ink[j]) >= CLOSE) continue;
    const hi = Math.atan2(oklab(ink[i])[2], oklab(ink[i])[1]), hj = Math.atan2(oklab(ink[j])[2], oklab(ink[j])[1]), way = Math.sin(hi - hj) >= 0 ? 1 : -1;
    const [bi, bj] = [ink[i], ink[j]];
    for (let d = STEP; d <= MAX_TURN && dist(ink[i], ink[j]) < CLOSE; d += STEP) { ink[i] = turn(bi, way * d); ink[j] = turn(bj, -way * d); }
  }
  return new Map(routes.map((r, k) => [r.color.toUpperCase(), rgbHex(ink[k])]));
}

/** The Aggie Shuttle's loops on the map, each kept apart from Connect's lines as this map draws them (`routes`,
 *  '#rrggbb') and from the loops before it: moved the least it takes in OKLCH (lighter or darker, stronger or softer, its
 *  hue turned a little) to APART from every one, and readable on the map's land (3:1). On the dark map the loops start
 *  lifted as the routes are, and a red lifted there came back to Route 2's red: kept apart there too, in the dark
 *  map's own colours. Light map, the loops come in already apart from the feed's colours (tools/usu.py). */
const DARK_LAND = [0x10, 0x12, 0x14].map(x => x / 255), APART = 0.11;
/** A colour with no hue: black, a grey. */
export const hueless = hex => { const [, a, b] = oklab(hexRGB(hex)); return Math.hypot(a, b) < 0.02; };
/** Too faint on its map's land to read as a line on its own (black on the dark map): drawn outlined. */
export const faint = (hex, darkMap) => contrast(hexRGB(hex), darkMap ? DARK_LAND : LAND) < MIN_CONTRAST;
export function apartInks(loops, routes, darkMap) {
  const land = darkMap ? DARK_LAND : LAND, placed = routes.map(hexRGB), out = [];
  const shows = v => v.every(x => x >= -0.002 && x <= 1.002);
  const apart = v => placed.every(p => dist(v, p) >= APART);
  const ok = v => shows(v) && contrast(v, land) >= MIN_CONTRAST && apart(v);
  for (const hex of loops) {
    const v0 = hexRGB(hex), [L0, a0, b0] = oklab(v0), C0 = Math.hypot(a0, b0), H0 = Math.atan2(b0, a0);
    // A loop with no hue (the Evening Express's black) keeps its own where it's apart: faint on its land, it's
    // outlined (faint()), not given a colour it hasn't got (black came out a brown on the dark map).
    let best = ok(v0) || hueless(hex) && apart(v0) ? { v: v0, cost: 0 } : null;
    if (!best) for (let dL = -0.3; dL <= 0.3; dL += 0.02) for (let dC = -0.12; dC <= 0.1; dC += 0.02) for (const dH of [0, -8, 8, -16, 16, -24, 24]) {
      const C = Math.max(0, C0 + dC), H = H0 + dH * Math.PI / 180, v = fromOklab([L0 + dL, C * Math.cos(H), C * Math.sin(H)]);
      if (!ok(v)) continue;
      const cost = Math.hypot(dL, C - C0, C0 * (H - H0));   // the least change that does it
      if (!best || cost < best.cost) best = { v, cost };
    }
    const v = best ? best.v : v0;
    out.push(rgbHex(v)); placed.push(v);
  }
  return out;
}
