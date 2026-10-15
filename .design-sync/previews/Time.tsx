import { Time } from 'cacherider';

const box = { display: 'flex', gap: 20, alignItems: 'baseline', flexWrap: 'wrap' as const, padding: 16, background: 'var(--color-bg)' };

/** The timetable's time, and the feed's estimate in blue. */
export const TimetableAndEstimate = () => (
  <div style={box}><Time time="8:06" meridiem="AM" /><Time time="8:09" meridiem="AM" estimate /></div>
);

/** Moved by the feed: the timetable's time crossed out before the estimate. */
export const Moved = () => (
  <div style={box}><Time time="3:19" meridiem="PM" estimate was="3:15" /></div>
);

/** Minutes out, and due. */
export const MinutesOut = () => (
  <div style={box}><Time minutes={4} /><Time minutes={0} /><Time minutes={12} size={60} /></div>
);

/** The sizes: 60 the next bus, 42, 26 a departure row, 22 a stop row, 17. */
export const Sizes = () => (
  <div style={box}>
    {([60, 42, 26, 22, 17] as const).map(s => <Time key={s} time="10:45" meridiem="PM" size={s} />)}
  </div>
);
