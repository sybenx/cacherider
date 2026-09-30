// Route lines on the light map: the feed's colours, sunk where they're too pale to see and pulled apart where two
// that share streets come out alike. Worked out from the colours and the stops, nothing picked by hand; the badges
// keep the feed's own colours (they're what's on the bus). The dark map lifts its own the other way (lift, map.js).
// Pure: colours in, colours out.

const LAND = [0xef, 0xee, 0xea].map(x => x / 255);   // the light basemap's land, about
const MIN_CONTRAST = 3;   // a thin line reads at 3:1, as a graphic does (WCAG's non-text contrast)
const CLOSE = 0.06;       // two lines this near in OKLab, on the same street, read as one
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
/** Darkened toward black, hue kept, just to the contrast a line needs on the light land. */
function sink(v) {
  let t = 0, w = v;
  while (contrast(w, LAND) < MIN_CONTRAST && t < 0.6) { t += 0.02; w = v.map(x => x * (1 - t)); }
  return w;
}
/** Its hue turned by `deg` in OKLCH, lightness and chroma kept (then sunk again, should the turn have paled it). */
function turn(v, deg) {
  const [L, a, b] = oklab(v), C = Math.hypot(a, b), h = Math.atan2(b, a) + deg * Math.PI / 180;
  return sink(fromOklab([L, C * Math.cos(h), C * Math.sin(h)]));
}

/** For each route, { color: 'RRGGBB', stops: Set of stop ids }: its line's colour on the light map, as a Map from the
 *  feed's colour (upper case, no #) to '#rrggbb'. Pairs that share two stops or more and come out closer than CLOSE
 *  are turned apart, each its own way, a step at a time, till they aren't or they've turned MAX_TURN. */
export function lightInks(routes) {
  const ink = routes.map(r => sink(hexRGB('#' + r.color)));
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    if (routes[i].color.toUpperCase() === routes[j].color.toUpperCase()) continue;   // the same colour on purpose (16 AM and PM): left so
    let shared = 0;
    for (const s of routes[i].stops) if (routes[j].stops.has(s) && ++shared >= 2) break;
    if (shared < 2) continue;
    // Which way each turns: away from the other, round the hue circle.
    const hi = Math.atan2(oklab(ink[i])[2], oklab(ink[i])[1]), hj = Math.atan2(oklab(ink[j])[2], oklab(ink[j])[1]);
    const way = Math.sin(hi - hj) >= 0 ? 1 : -1;
    const [bi, bj] = [ink[i], ink[j]];
    for (let d = STEP; d <= MAX_TURN && dist(ink[i], ink[j]) < CLOSE; d += STEP) { ink[i] = turn(bi, way * d); ink[j] = turn(bj, -way * d); }
  }
  return new Map(routes.map((r, k) => [r.color.toUpperCase(), rgbHex(ink[k])]));
}
