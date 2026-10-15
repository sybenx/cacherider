// Builds Cache Rider's parts for Claude Design (the design-sync converter reads dist/): the components bundled with
// the app's own icons and Pumpkin Walk art (app/icons.js, app/views/pumpkin-art.js), their types, and the app's own
// stylesheet and fonts beside them, untouched. Run from the repo root: node .design-sync/pkg/build.mjs
// (esbuild and typescript resolve from .design-sync/node_modules, the staged converter's: see NOTES.md).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const pkg = dirname(fileURLToPath(import.meta.url));
const repo = resolve(pkg, '../..');
const dist = join(pkg, 'dist');
rmSync(dist, { recursive: true, force: true });

// The icon names the types offer must be the app's set exactly: a name dropped from app/icons.js would draw nothing.
const { ICONS } = await import(pathToFileURL(join(repo, 'app/icons.js')).href);
const typed = [...readFileSync(join(pkg, 'src/layout/Icon.tsx'), 'utf8').match(/export type IconName =([^;]+);/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const missing = Object.keys(ICONS).filter(n => !typed.includes(n)), extra = typed.filter(n => !(n in ICONS));
if (missing.length || extra.length) {
  console.error(`IconName is out of step with app/icons.js: missing ${missing.join(', ') || '-'}; not in the app ${extra.join(', ') || '-'}`);
  process.exit(1);
}

await build({
  entryPoints: [join(pkg, 'src/index.ts')], outfile: join(dist, 'index.js'), bundle: true, format: 'esm',
  platform: 'browser', target: 'es2020', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom'], logLevel: 'warning',
});

// The app's stylesheet and fonts as they ship, and after it the few rules a part needs outside the app's own frame
// (src/parts.css): one file, as the converter copies it unfollowed, in dist/css/ where app.css's ../fonts/ finds them.
mkdirSync(join(dist, 'css'), { recursive: true });
writeFileSync(join(dist, 'css/cacherider.css'), readFileSync(join(repo, 'css/app.css'), 'utf8')
  + "\n\n/* ---- the parts' own (.design-sync/pkg/src/parts.css) ---- */\n" + readFileSync(join(pkg, 'src/parts.css'), 'utf8'));
mkdirSync(join(dist, 'fonts'), { recursive: true });
for (const f of readdirSync(join(repo, 'fonts'))) if (f.endsWith('.woff2') || f === 'OFL.txt') cpSync(join(repo, 'fonts', f), join(dist, 'fonts', f));

const tsc = join(pkg, '../node_modules/typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', join(pkg, 'tsconfig.json')], { stdio: 'inherit' });
console.log('built', dist);
