import { RouteBadge, RouteBadges } from './RouteBadge';
import { Time } from './Time';
import { LiveMark, ScheduledMark, type DepartureStatus } from './LiveMark';

export interface NextBus {
  route: string;
  time: string;
  meridiem: 'AM' | 'PM';
  /** 'in 4 min', 'now'. */
  relative: string;
  /** Default 'scheduled'. */
  status?: DepartureStatus;
  onTime?: boolean;
}

export interface StopRowProps {
  /** The stop's street address, as the timetable names it: '400 N 100 E'. */
  name: string;
  /** The town, when it isn't Logan: shown ', Hyde Park' after the name. */
  town?: string;
  /** The landmark the bus announces: 'Across from Eccles Ice Center'. */
  landmark?: string;
  /** The stop's number on its sign. */
  stopCode?: string;
  /** How far, with a fix: '120 m'. */
  distance?: string;
  /** The routes that call here. */
  routes: string[];
  /** Its next bus, at the right. Leave out for `none`. */
  next?: NextBus;
  /** What the right side says when there's no next bus. Default 'No service today'. */
  none?: string;
  /** A detour is taking a route round this stop today. */
  detour?: boolean;
  /** The stop nearest the rider: marked as here. */
  here?: boolean;
  href?: string;
}

/**
 * A stop in a list (near me, search, saved): its address, where it is and its routes on the left, its next bus at
 * the right, live when the feed knows. The whole row is the link to the stop's page.
 */
export function StopRow({ name, town, landmark, stopCode, distance, routes, next, none, detour, here, href = '#' }: StopRowProps) {
  const dist = [distance, landmark, stopCode ? 'Stop ' + stopCode : ''].filter(Boolean).join(' · ');
  return (
    <a className={here ? 'stoprow here' : 'stoprow'} href={href}>
      <div className="mid">
        <span className="name">{name}{town && town !== 'Logan' ? <span className="town">, {town}</span> : null}</span>
        <span className="dist">{dist}{detour ? <>{dist ? ' · ' : ''}<span className="alert">Detour</span></> : null}</span>
        <RouteBadges routes={routes} size={24} />
      </div>
      {next ? (
        <div className="end">
          <div className="when"><RouteBadge route={next.route} size={20} /><Time time={next.time} meridiem={next.meridiem} size={22} estimate={(next.status || 'scheduled') !== 'scheduled'} /></div>
          <span className="rel">{next.relative}</span>
          {(next.status || 'scheduled') === 'scheduled' ? <ScheduledMark onTime={next.onTime} /> : <LiveMark text={next.status === 'estimated' ? 'Estimated' : 'Live'} />}
        </div>
      ) : (
        <div className="end"><span className="rel">{none || 'No service today'}</span></div>
      )}
    </a>
  );
}
