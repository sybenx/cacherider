export type TimeSize = 17 | 20 | 21 | 22 | 25 | 26 | 36 | 42 | 56 | 60;

export interface TimeProps {
  /** The clock time without its meridiem: '8:06'. */
  time?: string;
  /** 'AM' or 'PM', set small after the time. */
  meridiem?: 'AM' | 'PM';
  /** Minutes until the bus instead of a clock time: 0 or less reads NOW. For a loop spacing its buses, or a bus due. */
  minutes?: number;
  /** Type size in px: 60 the next bus, 26 a departure row, 22 a stop row, 20 inline. Default 26. */
  size?: TimeSize;
  /** The feed's estimate rather than the timetable's minute: set in the accent blue. */
  estimate?: boolean;
  /** The timetable's time, crossed out before the estimate, when the feed has moved the bus by two minutes or more. */
  was?: string;
}

/**
 * A time in the heading type (Barlow Condensed, tabular figures), its meridiem small: the timetable's in the text
 * colour, the feed's estimate in accent blue, or minutes out ('4 MIN', 'NOW'). The big number on every screen.
 */
export function Time({ time, meridiem, minutes, size = 26, estimate = false, was }: TimeProps) {
  if (minutes !== undefined) {
    return <span className={`t t-${size} est`}>{minutes <= 0 ? 'NOW' : <>{minutes}<small>MIN</small></>}</span>;
  }
  const t = <span className={`t t-${size}${estimate ? ' est' : ''}`}>{time}{meridiem ? <small>{meridiem}</small> : null}</span>;
  if (!was) return t;
  return <span className="whent"><s className="was" style={{ fontSize: Math.max(12, Math.round(size * 0.55)) / 16 + 'rem' }}>{was}</s>{t}</span>;
}
