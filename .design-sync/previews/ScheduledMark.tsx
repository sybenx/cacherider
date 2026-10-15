import { ScheduledMark } from 'cacherider';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: 16, background: 'var(--color-bg)' };

/** By the timetable; the feed saying it's on time; a stop called at only on request. */
export const Kinds = () => (
  <div style={col}>
    <ScheduledMark />
    <ScheduledMark onTime />
    <ScheduledMark onRequest />
  </div>
);
