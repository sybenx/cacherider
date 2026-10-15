import { PumpkinNextShuttle } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** Inside the half hour: the minutes large, the next few after it. */
export const Soon = () => (
  <div style={phone}>
    <PumpkinNextShuttle from="Greenville" to="Park" minutes={4} when="6:20 PM"
      then={[{ time: '6:25', meridiem: 'PM' }, { time: '6:30', meridiem: 'PM' }, { time: '6:35', meridiem: 'PM' }]} />
  </div>
);

/** Due now, live, from the stop nearest the rider. */
export const NowLive = () => (
  <div style={phone}>
    <PumpkinNextShuttle from="Park" to="Greenville" minutes={0} when="7:42 PM" status="live" statusText="Live · on time" nearest
      then={[{ time: '7:47', meridiem: 'PM' }, { time: '7:52', meridiem: 'PM' }]} />
  </div>
);

/** The afternoon before: tonight's first, by the clock. */
export const FirstTonight = () => (
  <div style={phone}><PumpkinNextShuttle first from="Greenville" to="Park" time="6:00" meridiem="PM" when="Tonight · in 3 h 55 min" /></div>
);
