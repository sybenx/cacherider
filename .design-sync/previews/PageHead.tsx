import { PageHead, RouteBadges } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** A stop's page: Back, its number and town, its address, its routes. */
export const StopPage = () => (
  <div style={phone}>
    <PageHead back="Stops" eyebrow="Stop 1043 · Logan" title="400 N 100 E">
      <RouteBadges routes={['2', '3', '12']} size={30} wide />
    </PageHead>
  </div>
);

/** The Pumpkin Walk's: a season's page, a line under its title. */
export const SeasonPage = () => (
  <div style={phone}>
    <PageHead eyebrow="Seasonal · North Logan" title="Pumpkin Walk" sub="Connect's shuttle · Every 5 min · 6 PM–10 PM · through Tue 20 Oct" />
  </div>
);

/** Tight, on a sheet over the map. */
export const Tight = () => (
  <div style={phone}><PageHead tight eyebrow="Route 12" title="to Logan Regional Hospital" /></div>
);
