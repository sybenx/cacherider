import { PumpkinPerch, PageHead } from 'cacherider';

/** On a phone's pull-up card, over the map: the vine along its top edge, pumpkins sitting on it. */
export const OnTheCard = () => (
  <div style={{ width: 390, paddingTop: 56, background: 'var(--color-surface)' }}>
    <div style={{ background: 'var(--color-bg)', boxShadow: 'var(--shadow-lg)' }}>
      <PumpkinPerch />
      <div style={{ width: 40, height: 4, borderRadius: 2, background: 'var(--cr-line)', margin: '0 auto 6px' }} />
      <PageHead eyebrow="Seasonal · North Logan" title="Pumpkin Walk" sub="Connect's shuttle · Every 5 min · 6 PM–10 PM" />
    </div>
  </div>
);
