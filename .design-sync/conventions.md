# Cache Rider: how to design with it

Cache Rider is a bus app for Cache Valley, Utah (CVTD's buses; the shuttle brand is "Connect"). It isn't a React app:
these components are thin React adapters that write the app's own markup, styled by the app's own stylesheet
(`styles.css` -> `_ds_bundle.css`, which is the app's `css/app.css` verbatim plus a few part rules at its end). Build
with them and the result is the app's look exactly.

## Setup

- No provider or wrapper. Link `styles.css`; components work anywhere.
- Phone first: design at 390 px wide on `var(--color-bg)`. The app's layout switches at 840 px (wider: the page is a
  420 px column beside a map, and the bottom `TabBar` gives way to links in a top bar).
- Theme: `data-theme="dark"` on `<html>` for dark, `"light"` (or unset) for light; the tokens have one dark scope,
  `:root[data-theme="dark"]` (the app writes the attribute from the device's setting before first paint). Every token
  flips; the route colours and the Pumpkin Walk's night palette don't.

## The look (the "Industry" system)

- Type: `var(--font-heading)` (Barlow Condensed, 600) for times, titles and section heads; `var(--font-body)` (Barlow)
  for everything else. Times are always `Time` (tabular figures, meridiem small).
- Colour: the route badges' agency colours are the only colour, plus the steel accent `var(--color-accent)` /
  `var(--color-accent-700)` for links, live estimates and the current tab. Never tint a route badge in a brand colour.
- Lines, not boxes: lists are full-width rows with hairlines (`var(--cr-line)`), no cards, no rounded panels. Use
  `Blueprint` (hairline + corner crop marks, square) for the one or two objects a screen needs edges on.
- Live vs scheduled is the core distinction: the feed's estimate in accent blue with `LiveMark`; the timetable's time in
  the text colour with `ScheduledMark`. A moved bus shows the timetable's time struck through (`was`).
- Tokens for your own layout glue: `--color-bg`, `--color-surface`, `--color-text`, `--color-accent`,
  `--color-accent-100`, `--color-accent-700`, `--color-divider`, `--cr-muted`, `--cr-line`, `--cr-hover`,
  `--shadow-md`, `--shadow-lg`, `--radius-md` (4 px), `--warn-bg` / `--warn-ink` / `--warn-edge`, `--cr-late`.
- App classes you may reuse for glue: `eyebrow` (small accent caps), `muted`, `fine` (small print block), `list`
  (hairline above a stack of rows).
- Words: as riders say them. 'in 4 min', 'to Smithfield', 'Blue Loop', 'Transit Center', '2:41 PM'. Sentence case,
  no exclamation marks.

## The Pumpkin Walk (seasonal, October)

North Logan's evening pumpkin walk, served by Connect's shuttle (route 'Pumpkin Walk', a loop from Greenville to the
Park and back, every 5 min, 6 PM to 10 PM). The app's view of it is the night (this project's
templates/pumpkin-walk-explore, built): background #16112b, text #f3eee6, muted #b9b0c9, pumpkin orange #e8611c, in
either theme. Its parts: `PumpkinDusk` (the
banner), `PumpkinVines` (frames the map of the walk: keep the subject about 52 px in from the sides), `PumpkinPerch`
(a vine on top of a phone's pull-up card), `PumpkinNextShuttle`, `PumpkinNights`. Pumpkins decorate the edges; the
content stays the app's plain rows and times.

## Where the truth lives

Each component's `components/<group>/<Name>/<Name>.prompt.md` and `.d.ts`; the stylesheet `_ds_bundle.css`. Route
colours: `window.CacheRider.cvtdRoutes` (short name -> colour, text colour, long name); `RouteBadge route="12"` needs
nothing more.

## A stop's page

```jsx
const { PageHead, RouteBadges, NextDeparture, SectionHead, DepartureRow, TabBar } = window.CacheRider;
<div style={{ width: 390, background: 'var(--color-bg)' }}>
  <PageHead back="Stops" eyebrow="Stop 1043 · Logan" title="400 N 100 E"><RouteBadges routes={['2', '3', '12']} size={30} wide /></PageHead>
  <NextDeparture route="3" headsign="to Hyde Park" time="2:41" meridiem="PM" relative="in 6 min" status="live" statusText="Live · on time" />
  <SectionHead icon="clock" title="Later today" />
  <div className="list">
    <DepartureRow route="2" headsign="to Smithfield" time="2:47" meridiem="PM" was="2:43" relative="in 12 min" status="live" statusText="Live · 4 min late" />
    <DepartureRow route="12" headsign="to Logan Regional Hospital" time="2:52" meridiem="PM" relative="in 17 min" />
  </div>
  <TabBar tabs={[{ label: 'Stops', icon: 'stops', current: true }, { label: 'Map', icon: 'map' }, { label: 'Transit Center', icon: 'hub' }]} />
</div>
```
