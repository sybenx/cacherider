import { Notice } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** Today's detours, on the home page and the Transit Center. */
export const Detours = () => (
  <div style={phone}><Notice icon="ban"><b>2 detours</b> on routes 2 and 5 · <a href="#">details</a></Notice></div>
);

/** The Pumpkin Walk's shuttles on the road. */
export const OnTheRoad = () => (
  <div style={phone}><Notice icon="route"><b>2 shuttles on the road</b> · on the map</Notice></div>
);

/** A plain word. */
export const Info = () => (
  <div style={phone}><Notice>Times are the published timetable, and live where the feed has the bus.</Notice></div>
);
