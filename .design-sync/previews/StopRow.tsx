import { StopRow } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** Near me: how far, the landmark, the number, the next bus live. */
export const NearMe = () => (
  <div style={phone}>
    <StopRow here name="400 N 100 E" distance="120 m" landmark="Logan Library" stopCode="1043" routes={['2', '3', '12']}
      next={{ route: '3', time: '2:41', meridiem: 'PM', relative: 'in 6 min', status: 'live' }} />
    <StopRow name="Main St & 300 N" distance="350 m" stopCode="1012" routes={['1', '2', 'B']}
      next={{ route: 'B', time: '2:44', meridiem: 'PM', relative: 'in 9 min' }} />
  </div>
);

/** Out of town, a detour today, and a stop with no more buses. */
export const DetourAndNone = () => (
  <div style={phone}>
    <StopRow name="Center St & 100 E" town="Hyde Park" stopCode="2210" routes={['3']} detour
      next={{ route: '3', time: '3:12', meridiem: 'PM', relative: 'in 37 min', onTime: true }} />
    <StopRow name="1200 E 1400 N" town="North Logan" stopCode="2301" routes={['16 AM']} none="No more today" />
  </div>
);
