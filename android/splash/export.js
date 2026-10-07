// The Android app's launch splash, from its source: android/splash/splash.svg (a 300 × 640 canvas, the bus over the
// road on #101214) to a PNG for each screen density, into app/src/main/res/drawable-*dpi/splash.png.
//
//   node android/splash/export.js        (after `npm ci` in tools/smoke, whose Playwright draws it)
//
// The splash fills the screen (SplashLauncher.java, CENTER_CROP), so each density's image is a phone screen's worth:
// 360 dp across at that density, the canvas's own proportions (2.13:1). A taller phone crops a little off the sides
// (the speed lines and the road run off them anyway), a wider one a little off the top and bottom.
// Run it again after changing the SVG; the PNGs are kept in the repo, so a build needs nothing but Gradle.
const path = require('path');
const { chromium } = require(path.join(__dirname, '../../tools/smoke/node_modules/playwright'));
const fs = require('fs');

const SVG = fs.readFileSync(path.join(__dirname, 'splash.svg'), 'utf8').replace(/<metadata>[\s\S]*?<\/metadata>/, '');
const RES = path.join(__dirname, '../app/src/main/res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const W = 360, H = Math.round(360 * 640 / 300);   // dp: 360 × 768

(async () => {
  const browser = await chromium.launch();
  for (const [name, k] of Object.entries(DENSITIES)) {
    const w = Math.round(W * k), h = Math.round(H * k);
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:#101214}svg{display:block;width:${w}px;height:${h}px}</style>${SVG}`);
    const dir = path.join(RES, 'drawable-' + name);
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'splash.png'), omitBackground: false });
    console.log(`drawable-${name}/splash.png  ${w} × ${h}`);
    await page.close();
  }
  await browser.close();
})();
