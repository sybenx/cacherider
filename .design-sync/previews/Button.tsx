import { Button } from 'cacherider';

const box = { display: 'flex', flexWrap: 'wrap' as const, gap: 10, alignItems: 'center', padding: 16, background: 'var(--color-bg)' };

/** The three kinds: the page's one main action, a quieter one, and Back. */
export const Variants = () => (
  <div style={box}>
    <Button icon="walk">How to get to Greenville</Button>
    <Button variant="secondary">What's next</Button>
    <Button variant="ghost" icon="back">Stops</Button>
  </div>
);

/** Full width at the foot of a list, and disabled. */
export const BlockAndDisabled = () => (
  <div style={{ ...box, width: 390, flexDirection: 'column', alignItems: 'stretch' }}>
    <Button variant="secondary" block large>Every departure today</Button>
    <Button icon="route" disabled>How to get here</Button>
  </div>
);
