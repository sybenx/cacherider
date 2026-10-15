import { RouteBadge } from './RouteBadge';
import { Time } from './Time';
import { StatusMark, type DepartureStatus } from './LiveMark';

export interface NextDepartureProps {
  route: string;
  /** 'to Smithfield', 'Blue Loop'. */
  headsign: string;
  /** The clock time; the feed's estimate when `status` isn't 'scheduled'. */
  time?: string;
  meridiem?: 'AM' | 'PM';
  /** A loop spacing its buses: minutes out, large, instead of a clock time. */
  minutesOut?: number;
  /** Beside the big time: 'in 6 min', or the day: 'Tomorrow'. */
  relative?: string;
  /** Default 'scheduled'. */
  status?: DepartureStatus;
  /** 'Live · 3 min late'. */
  statusText?: string;
  onTime?: boolean;
  /** The timetable's time, '3:15 PM', said above the estimate when the feed has moved the bus. */
  was?: string;
  /** 'Last bus'. */
  lastRun?: string;
  /** Default 'Next bus'. */
  eyebrow?: string;
}

/**
 * The next bus, large: the top of a stop's page. An eyebrow and the feed's word, the time at 60 px with how long
 * till it, and the route and where it's headed. Hairlines above and below; full width.
 */
export function NextDeparture(p: NextDepartureProps) {
  const { route, headsign, time, meridiem, minutesOut, relative, status = 'scheduled', statusText, onTime, was, lastRun, eyebrow = 'Next bus' } = p;
  const live = status !== 'scheduled';
  return (
    <div className="next">
      <div className="top"><span className="eyebrow">{eyebrow}</span><StatusMark status={status} text={statusText} onTime={onTime} /></div>
      {live && was && minutesOut === undefined ? <span className="wasline">Scheduled <s>{was}</s></span> : null}
      <div className="big">
        {minutesOut !== undefined ? <Time minutes={minutesOut} size={60} />
          : <><Time time={time} meridiem={meridiem} size={60} estimate={live} /><span className="rel">{relative}</span></>}
      </div>
      <div className="who"><RouteBadge route={route} size={32} /><span>{headsign}</span></div>
      {lastRun ? <span className="lastrun">{lastRun}</span> : null}
    </div>
  );
}
