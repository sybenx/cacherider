// The Android app's launch splash, from its source: android/splash/splash.svg (a 300 × 300 canvas: the bus over the
// road, the speed lines and road fading out at the sides, on nothing) to a PNG for each screen density, into
// app/src/main/res/drawable-*dpi/splash.png.
//
//   node android/splash/export.js        (after `npm ci` in tools/smoke, whose Playwright draws it)
//
// It's shown centred at its own size (SplashLauncher.java, CENTER) on the splash colour, #101214: 300 dp square, so
// each density's image is 300 dp at that density. Inside any phone's width, upright or on its side; nothing cropped.
// Run it again after changing the SVG; the PNGs are kept in the repo, so a build needs nothing but Gradle.
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tools/smoke/node_modules/playwright'));
const fs = require('fs');

const SVG = fs.readFileSync(path.join(__dirname, 'splash.svg'), 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '');
const RES = path.join(__dirname, '../app/src/main/res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const W = 300, H = 300;   // dp

(async () => {
  const browser = await chromium.launch();
  for (const [name, k] of Object.entries(DENSITIES)) {
    const w = Math.round(W * k), h = Math.round(H * k);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${w}px;height:${h}px}</style>${SVG}`);
    const dir = path.join(RES, 'drawable-' + name);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'splash.png'), omitBackground: true });   // see-through: the splash colour behind
    console.log(`drawable-${name}/splash.png  ${w} × ${h}`);
    await page.close();
  }
  await browser.close();
})();
