import { LiveMark } from 'cacherider';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 10, padding: 16, background: 'var(--color-bg)' };

/** What the feed says, in its words. */
export const FeedWords = () => (
  <div style={col}>
    <LiveMark />
    <LiveMark text="Live · on time" />
    <LiveMark text="Live · 3 min late" />
    <LiveMark text="Estimated · 2 min late" />
  </div>
);
