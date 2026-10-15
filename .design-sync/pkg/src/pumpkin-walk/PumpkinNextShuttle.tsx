import { Time } from '../transit/Time';
import { StatusMark, type DepartureStatus } from '../transit/LiveMark';

export interface ShuttleTime { time: string; meridiem: 'AM' | 'PM' }

export interface PumpkinNextShuttleProps {
  /** The stop it leaves from: 'Greenville' or 'Park'. */
  from: string;
  /** Where it goes: 'Park' or 'Greenville'. */
  to: string;
  /** Minutes till it, inside the half hour: large, 0 reads NOW. */
  minutes?: number;
  /** Further off: the clock time instead, large. */
  time?: string;
  meridiem?: 'AM' | 'PM';
  /** Under the destination: the clock time when `minutes` is shown ('6:20 PM'), else when ('Tonight · in 3 h 55 min', 'Friday evening'). */
  when: string;
  /** The next few after it, the same evening. */
  then?: ShuttleTime[];
  /** Default 'scheduled'. */
  status?: DepartureStatus;
  /** 'Live · on time'. */
  statusText?: string;
  /** The rider's nearest stop, by their location. */
  nearest?: boolean;
  /** The evening's first rather than the next ('First shuttle from …'). */
  first?: boolean;
}

/**
 * The Pumpkin Walk's next shuttle: from which stop, the minutes (or time) large with the pumpkin-orange MIN, where to
 * and when, and the next few after it. Where a phone's card rests, under the map of the walk.
 */
export function PumpkinNextShuttle(p: PumpkinNextShuttleProps) {
  const { from, to, minutes, time, meridiem, when, then = [], status = 'scheduled', statusText, nearest, first } = p;
  const est = status !== 'scheduled' ? ' est' : '';
  const big = minutes !== undefined
    ? <span className={'pk-big' + est}>{minutes <= 0 ? 'NOW' : minutes}{minutes > 0 ? <small>MIN</small> : null}</span>
    : <span className={'pk-big pk-clock' + est}><Time time={time} meridiem={meridiem} size={36} estimate={!!est} /></span>;
  return (
    <div className="next pk-next">
      <div className="top"><span className="eyebrow">{first ? 'First shuttle' : 'Next shuttle'} from {from}{nearest ? ' · nearest you' : ''}</span><StatusMark status={status} text={statusText} /></div>
      <a className="pk-nextrow" href="#">{big}<span className="mid"><span className="dest">To {to}</span><span className="sub">{when}</span></span></a>
      {then.length ? <div className="then"><span className="eyebrow muted">Then</span>{then.map(t => <span key={t.time} className="t t-22"><Time time={t.time} meridiem={t.meridiem} size={22} /></span>)}</div> : null}
    </div>
  );
}
