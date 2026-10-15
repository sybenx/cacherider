import { Icon } from '../layout/Icon';

export interface LiveMarkProps {
  /** What the feed says: 'Live', 'Live · on time', 'Live · 3 min late', 'Estimated', 'Estimated · 2 min late'. Default 'Live'. */
  text?: string;
}

/** A departure the real-time feed knows about: a still accent dot and the feed's word, in small caps. It never pulses. */
export function LiveMark({ text = 'Live' }: LiveMarkProps) {
  return <span className="livetag"><i></i>{text}</span>;
}

export interface ScheduledMarkProps {
  /** The feed says the bus is keeping to its time: 'Scheduled · on time'. */
  onTime?: boolean;
  /** A stop the bus calls at only when asked: 'On request'. */
  onRequest?: boolean;
}

/** A departure by the timetable alone (no word from the feed): a small clock and 'Scheduled', muted, in small caps. */
export function ScheduledMark({ onTime = false, onRequest = false }: ScheduledMarkProps) {
  if (onRequest) return <span className="sched req" title="The bus calls here this way only when asked">On request</span>;
  return <span className="sched"><Icon name="clock" size={11} />Scheduled{onTime ? ' · on time' : ''}</span>;
}

/** Where a departure's time comes from: the timetable, the feed's own word, or worked out from the bus's place. */
export type DepartureStatus = 'scheduled' | 'live' | 'estimated';

/** The mark for a status: LiveMark for live and estimated (with `text` if given), ScheduledMark otherwise. */
export function StatusMark({ status = 'scheduled', text, onTime }: { status?: DepartureStatus; text?: string; onTime?: boolean }) {
  if (status === 'scheduled') return <ScheduledMark onTime={onTime} />;
  return <LiveMark text={text || (status === 'estimated' ? 'Estimated' : 'Live')} />;
}
