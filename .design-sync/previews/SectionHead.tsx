import { SectionHead, DepartureRow } from 'cacherider';

const phone = { width: 390, background: 'var(--color-bg)' };

/** Over a list, with an icon. */
export const WithIcon = () => (
  <div style={phone}><SectionHead icon="calendar" title="The shuttle's nights" /></div>
);

/** With a link at the right, over the rows it heads. */
export const WithNote = () => (
  <div style={phone}>
    <SectionHead icon="pin" title="From Greenville" note="Stop 8000" noteHref="#" />
    <DepartureRow route="Pumpkin Walk" headsign="To Park" time="6:20" meridiem="PM" relative="in 4 min" />
  </div>
);

/** Plain. */
export const Plain = () => (
  <div style={phone}><SectionHead title="Saved stops" /></div>
);
