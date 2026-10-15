# Design sync notes (Claude Design project "Cache Rider")

Project: https://claude.ai/design/p/9263b2fe-9248-4dd0-83ce-6040c1429471 (first synced 2026-10-15, 20 components).

## How this repo syncs (off the converter's usual path)

- Cache Rider is a vanilla-JS PWA with no React and no package build. `.design-sync/pkg/` is a small React package made
  for the sync: each component writes the markup `app/ui.js` and the views write, so the app's own `css/app.css`
  styles it. `pkg/build.mjs` (cfg.buildCmd) bundles it to `pkg/dist/` (esbuild, react external), emits types (tsc),
  and writes `dist/css/cacherider.css` = `css/app.css` + `pkg/src/parts.css` (one file: the converter copies cssEntry
  without following @import) beside `dist/fonts/`.
- The icons and the Pumpkin Walk art are the app's own modules, imported straight in: `app/icons.js` and
  `app/views/pumpkin-art.js` (dependency-free on purpose). build.mjs fails if `IconName` in `pkg/src/layout/Icon.tsx`
  drifts from `app/icons.js`'s keys.
- Runs in WSL `pebble-sdk` on a /root mirror (drvfs on H: is unreliable for writes): `H:\WSL\ds.sh setup | build |
  validate | capture [--components A,B] | cmd '<shell>'`. setup stages the converter into /root/cr-ds/.ds-sync with
  esbuild, ts-morph, typescript, @types/react, react@18, react-dom@18, playwright@1.63.0 (matches the cached
  chromium-1243 build that tools/smoke uses), and links `.design-sync/node_modules` -> `../.ds-sync/node_modules`
  (pkg/build.mjs resolves esbuild and typescript through it).
- Grades live in /root/cr-ds/.design-sync/.cache/review (write them there, not on H:; ds.sh's rsync excludes .cache).
- Uploads read from `H:\Programs\cacherider\ds-bundle`, a robocopy /MIR of `\\wsl.localhost\pebble-sdk\root\cr-ds\ds-bundle`.
- Five components share a source file with another (RouteBadges, ScheduledMark, the three Pumpkin art parts):
  cfg.componentSrcMap pins them, else they land in group "general" without their JSDoc.
- `#tabs` is hidden by app.css at 840 px and wider; parts.css re-shows `#tabs.cr-tabbar` so TabBar renders in any
  design. `#pk-deco` (vines) and `.pk-perch` show only inside the app's frame; parts.css shows them in
  `.pk-frame` / `.pk-perch-part`.

## Known render warns

- None on the final build (validate clean, 20/20).
- esbuild warns `Duplicate key "share"` in app/icons.js: the app has two `share` icons, the second wins. Harmless; the
  app's own quirk (the first is dead).

## Re-sync risks

- The adapters copy markup from `app/ui.js` (badge, time, sched, liveMark, depRow, cancelledRow, stopRow), the stop
  page's `.next` block (`app/views/stop.js`), the tab bar (`app/main.js` renderTabs) and the Pumpkin Walk page
  (`app/views/pumpkin.js`). A change to that markup or its class names in the app doesn't reach the parts until the
  matching `.tsx` in `pkg/src/` is updated: diff those functions against the parts on every re-sync.
- `pkg/src/routes.ts` (cvtdRoutes) is a copy of data/cvtd.json's routes as of 2026-10-15. Re-copy when the feed's
  routes or colours change.
- `css/app.css` ships whole, app-frame rules (#app, #side, #map, #tabs) included; a new id-scoped rule there can
  surprise a design. Check the contact sheets after any app.css change.
- The Pumpkin Walk parts are seasonal; the route exists in the feed only in October.
- Since 2026-10-15 the app's Pumpkin Walk view is Claude Design's night 'line' (templates/pumpkin-walk-explore): its
  markup (.pk-fold, .pk-line, .pk-tonight, in app/views/pumpkin.js) has no parts here yet. PumpkinNextShuttle and
  PumpkinDusk are the first cut's: still styled by app.css, no longer drawn by the app.
- Theme: app.css has one dark scope, :root[data-theme="dark"]; index.html's head script always writes data-theme
  (light or dark, the device's when the rider hasn't picked) and keeps the pick in data-theme-mode.
