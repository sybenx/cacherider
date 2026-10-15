import { Blueprint, Button } from 'cacherider';

/** A framed nudge: hairline box, crop marks at the corners. */
export const Nudge = () => (
  <div style={{ width: 390, padding: 16, background: 'var(--color-bg)' }}>
    <Blueprint style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="eyebrow">Add to home screen</span>
      <span>Cache Rider opens from your home screen like an app, a tap away at the stop.</span>
      <Button icon="install" variant="secondary">Install</Button>
    </Blueprint>
  </div>
);

/** Around a figure. */
export const Figure = () => (
  <div style={{ width: 390, padding: 16, background: 'var(--color-bg)' }}>
    <Blueprint><div style={{ height: 140, background: 'var(--color-surface)', display: 'grid', placeItems: 'center', color: 'var(--cr-muted)' }}>Transit Center bays</div></Blueprint>
  </div>
);
