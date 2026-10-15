import { Icon } from 'cacherider';

const names = ['stops', 'map', 'hub', 'pumpkin', 'search', 'near', 'pin', 'route', 'walk', 'clock', 'calendar', 'history',
  'swap', 'back', 'fwd', 'up', 'down', 'chevDown', 'close', 'check', 'info', 'ban', 'star', 'share', 'shareup', 'copy',
  'mail', 'sliders', 'more', 'list', 'house', 'compass', 'globe', 'sun', 'moon', 'sunmoon', 'pointer', 'plusSquare', 'install'] as const;

/** The whole set, 24 px, in the text colour. */
export const AllIcons = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 72px)', gap: 4, padding: 16, background: 'var(--color-bg)', color: 'var(--color-text)' }}>
    {names.map(n => (
      <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 0', fontSize: 11, color: 'var(--cr-muted)' }}>
        <span style={{ color: 'var(--color-text)' }}><Icon name={n} size={24} /></span>{n}
      </div>
    ))}
  </div>
);

/** The sizes in use: 16 in a section head or notice, 18 in a button, 22 in the tab bar; in the accent where it's a link. */
export const SizesAndColour = () => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'center', padding: 16, background: 'var(--color-bg)', color: 'var(--color-text)' }}>
    <Icon name="calendar" size={16} /><Icon name="walk" size={18} /><Icon name="map" size={22} />
    <span style={{ color: 'var(--color-accent-700)' }}><Icon name="pumpkin" size={22} /></span>
  </div>
);
