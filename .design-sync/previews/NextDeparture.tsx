import { NextDeparture } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** By the timetable. */
export const Scheduled = () => (
  <div style={phone}><NextDeparture route="12" headsign="to Logan Regional Hospital" time="2:52" meridiem="PM" relative="in 17 min" /></div>
);

/** Live and moved: the estimate large, what it was said above. */
export const LiveLate = () => (
  <div style={phone}><NextDeparture route="2" headsign="to Smithfield" time="2:47" meridiem="PM" relative="in 12 min" status="live" statusText="Live · 4 min late" was="2:43 PM" /></div>
);

/** A loop spacing its buses: minutes out. */
export const LoopMinutes = () => (
  <div style={phone}><NextDeparture route="B" headsign="Blue Loop" minutesOut={4} status="estimated" statusText="Estimated" /></div>
);

/** The day's last. */
export const LastBus = () => (
  <div style={phone}><NextDeparture route="16 PM" headsign="to Preston" time="6:15" meridiem="PM" relative="in 3 h 40 min" lastRun="Last bus" /></div>
);
