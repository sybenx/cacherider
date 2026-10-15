import { RouteBadges } from 'cacherider';

const phone = { width: 390, padding: 16, background: 'var(--color-bg)' };

/** A stop's routes, in a list. */
export const InAList = () => (
  <div style={phone}><RouteBadges routes={['2', '3', '12', 'B']} /></div>
);

/** On the stop's own page: larger, wider gaps, wrapping. */
export const OnTheStopPage = () => (
  <div style={phone}><RouteBadges routes={['1', '2', '3', '5', '6', '7', '11', '12', '16 AM', '16 PM', 'G', 'B']} size={30} wide /></div>
);
