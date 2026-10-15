import { DepartureRow } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** By the timetable alone. */
export const Scheduled = () => (
  <div style={phone}><DepartureRow route="3" headsign="to Hyde Park · North Logan" time="2:41" meridiem="PM" relative="in 6 min" /></div>
);

/** The feed's word: the estimate in blue, the timetable's time crossed out beside it when moved. */
export const LiveAndLate = () => (
  <div style={phone}>
    <DepartureRow route="2" headsign="to Smithfield" time="2:47" meridiem="PM" was="2:43" relative="in 12 min" status="live" statusText="Live · 4 min late" />
    <DepartureRow route="12" headsign="to Logan Regional Hospital" time="2:52" meridiem="PM" relative="in 17 min" status="live" statusText="Live · on time" />
  </div>
);

/** A loop spacing its buses away from the Transit Center: minutes out, no clock time. */
export const LoopMinutesOut = () => (
  <div style={phone}><DepartureRow route="B" headsign="Blue Loop" time="2:39" meridiem="PM" minutesOut={4} status="estimated" statusText="Estimated" /></div>
);

/** The night's last, and a run the feed has cancelled. */
export const LastAndCancelled = () => (
  <div style={phone}>
    <DepartureRow route="16 PM" headsign="to Preston" time="6:15" meridiem="PM" relative="in 3 h 40 min" lastRun="Last bus" />
    <DepartureRow route="5" headsign="to Nibley · Millville" time="3:05" meridiem="PM" cancelled />
  </div>
);

/** A whole day's list: the ones gone faded. */
export const DayList = () => (
  <div style={phone}>
    <DepartureRow route="6" headsign="to USU · Old Main" time="1:58" meridiem="PM" relative="gone" past />
    <DepartureRow route="6" headsign="to USU · Old Main" time="2:28" meridiem="PM" relative="now" status="live" statusText="Live · 1 min late" />
    <DepartureRow route="6" headsign="to USU · Old Main" time="2:58" meridiem="PM" relative="in 30 min" />
  </div>
);
