import { RouteBadge } from './RouteBadge';
import { Time } from './Time';
import { StatusMark, type DepartureStatus } from './LiveMark';

export interface DepartureRowProps {
  /** The route's short name: '2', '16 AM', 'B'. */
  route: string;
  /** Where it's headed, as riders read it: 'to Smithfield', 'Blue Loop', 'to N Logan · CV Hospital'. */
  headsign: string;
  /** The clock time without meridiem: the timetable's, or the feed's estimate when `status` isn't 'scheduled'. */
  time: string;
  meridiem: 'AM' | 'PM';
  /** How long till it, under the time: 'in 4 min', 'now', 'gone'. */
  relative?: string;
  /** Where the time comes from. Default 'scheduled'. */
  status?: DepartureStatus;
  /** The live line under the headsign: 'Live · 3 min late'. Defaults to 'Live' or 'Estimated'. */
  statusText?: string;
  /** Scheduled, and the feed says it's keeping to its time. */
  onTime?: boolean;
  /** The timetable's time, crossed out before the estimate, when the feed has moved the bus by 2 min or more. */
  was?: string;
  /** A loop spacing its buses away from the Transit Center: minutes out instead of a clock time (no `relative`). */
  minutesOut?: number;
  /** The night's-end word: 'Last bus', 'Last to Preston'. */
  lastRun?: string;
  /** The feed says this run is cancelled: its time struck, nothing to count down to. */
  cancelled?: boolean;
  /** Already gone, in a whole day's list: drawn faded. */
  past?: boolean;
}

/**
 * One departure: the route badge, where it's headed and whether the feed knows it (Live, Estimated or Scheduled),
 * and the time with how long till it. A hairline under each row; rows stack edge to edge in a list, full width.
 */
export function DepartureRow(p: DepartureRowProps) {
  const { route, headsign, time, meridiem, relative, status = 'scheduled', statusText, onTime, was, minutesOut, lastRun, cancelled, past } = p;
  if (cancelled) {
    return (
      <div className="row cancelled"><RouteBadge route={route} size={36} />
        <div className="mid"><span className="name">{headsign}</span><span className="sub cancelnote">Cancelled</span></div>
        <div className="end"><s className="t t-26">{time}</s></div></div>
    );
  }
  const live = status !== 'scheduled';
  const row = (
    <div className="row"><RouteBadge route={route} size={36} />
      <div className="mid"><span className="name">{headsign}</span><StatusMark status={status} text={statusText} onTime={onTime} />
        {lastRun ? <span className="lastrun">{lastRun}</span> : null}</div>
      <div className="end">
        {minutesOut !== undefined ? <Time minutes={minutesOut} size={26} /> : <Time time={time} meridiem={meridiem} size={26} estimate={live} was={live ? was : undefined} />}
        {minutesOut !== undefined ? null : <span className="rel">{relative}</span>}
      </div></div>
  );
  return past ? <div style={{ opacity: 0.45 }}>{row}</div> : row;
}
