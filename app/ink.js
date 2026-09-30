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
