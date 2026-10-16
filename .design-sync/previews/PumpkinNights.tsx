import { PumpkinNights } from 'cacherider';

/** The season's nights from tonight, a Thursday, to the last: its Sundays without a shuttle, crossed out. */
export const Season = () => (
  <div style={{ width: 390, padding: '8px 0 16px', background: 'var(--color-bg)' }}>
    <PumpkinNights nights={[
      { date: 15, weekday: 3, hours: '6–10', tonight: true },
      { date: 16, weekday: 4, hours: '6–10' },
      { date: 17, weekday: 5, hours: '6–10' },
      { date: 18, weekday: 6 },
      { date: 19, weekday: 0, hours: '6–10' },
      { date: 20, weekday: 1, hours: '6–10' },
      { date: 21, weekday: 2, hours: '6–10' },
      { date: 22, weekday: 3, hours: '6–10' },
      { date: 23, weekday: 4, hours: '6–10' },
      { date: 24, weekday: 5, hours: '6–10' },
    ]} />
  </div>
);
