import { PumpkinNights } from 'cacherider';

/** The season's nights from tonight: a Sunday between without a shuttle. */
export const Season = () => (
  <div style={{ width: 390, padding: '8px 0 16px', background: 'var(--color-bg)' }}>
    <PumpkinNights nights={[
      { day: 'Tonight', date: '15 Oct', hours: '6–10 PM', tonight: true },
      { day: 'Fri', date: '16 Oct', hours: '6–10 PM' },
      { day: 'Sat', date: '17 Oct', hours: '6–10 PM' },
      { day: 'Sun', date: '18 Oct' },
      { day: 'Mon', date: '19 Oct', hours: '6–10 PM' },
      { day: 'Tue', date: '20 Oct', hours: '6–10 PM' },
    ]} />
  </div>
);
