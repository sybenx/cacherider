import { TabBar } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** The three tabs. */
export const ThreeTabs = () => (
  <div style={phone}>
    <TabBar tabs={[{ label: 'Stops', icon: 'stops', current: true }, { label: 'Map', icon: 'map' }, { label: 'Transit Center', icon: 'hub' }]} />
  </div>
);

/** In October, the Pumpkin Walk's tab beside them, it showing. */
export const WithSeasonTab = () => (
  <div style={phone}>
    <TabBar tabs={[{ label: 'Stops', icon: 'stops' }, { label: 'Map', icon: 'map' }, { label: 'Transit Center', icon: 'hub' }, { label: 'Pumpkin Walk', icon: 'pumpkin', current: true }]} />
  </div>
);
