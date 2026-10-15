import { RouteBadge } from 'cacherider';

const row = { display: 'flex', flexWrap: 'wrap' as const, gap: 8, alignItems: 'center', padding: 16, background: 'var(--color-bg)' };

/** Every CVTD route, at the departure-row size. */
export const AllRoutes = () => (
  <div style={row}>
    {['1', '2', '3', '5', '6', '7', '8', '9', '11', '12', '15', '16 AM', '16 PM', 'G', 'B', 'Pumpkin Walk'].map(r => <RouteBadge key={r} route={r} />)}
  </div>
);

/** The sizes the app draws: 44 on the Transit Center, 36 a departure row, 32 under the next bus, 24 a stop's list, 20 beside a time. */
export const Sizes = () => (
  <div style={row}>
    {([44, 36, 32, 30, 28, 24, 20] as const).map(s => <RouteBadge key={s} route="12" size={s} />)}
  </div>
);

/** A two-word name sets its second word small. */
export const TwoWordNames = () => (
  <div style={row}>
    <RouteBadge route="16 AM" /><RouteBadge route="16 PM" /><RouteBadge route="Pumpkin Walk" /><RouteBadge route="16 AM" size={24} />
  </div>
);
