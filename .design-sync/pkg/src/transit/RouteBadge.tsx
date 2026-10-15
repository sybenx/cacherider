import { cvtdRoutes } from '../routes';

export type BadgeSize = 20 | 24 | 28 | 30 | 32 | 36 | 44;

export interface RouteBadgeProps {
  /** The route's short name as the agency prints it: '2', '12', '16 AM', 'B' (Blue Loop), 'G' (Green Loop), 'Pumpkin Walk'. */
  route: string;
  /** Background, hex with or without '#'. Defaults to the route's own CVTD colour. */
  color?: string;
  /** Text colour, hex with or without '#'. Defaults to the route's own. */
  textColor?: string;
  /** Size in px: 36 in a departure row, 32 under the next bus, 24 in a stop's list, 20 inline beside a time. Default 36. */
  size?: BadgeSize;
}

const hex = (c: string) => (c.startsWith('#') ? c : '#' + c);

/**
 * The route badge: the route's short name on the agency's own colour, the only colour in the app besides the steel
 * accent. A two-word name ('16 AM', 'Pumpkin Walk') sets its second word small. Route colours are CVTD's; never
 * restyle a badge in a brand colour.
 */
export function RouteBadge({ route, color, textColor, size = 36 }: RouteBadgeProps) {
  const r = cvtdRoutes[route];
  const m = /^(\S+)\s+(\S+)$/.exec(route);
  return (
    <span className={`badge badge-${size}`} title={r ? r.long : undefined}
      style={{ background: hex(color || (r ? r.color : '5980a6')), color: hex(textColor || (r ? r.text : 'ffffff')) }}>
      {m ? <>{m[1]}<small>{m[2]}</small></> : route}
    </span>
  );
}

export interface RouteBadgesProps {
  /** The routes' short names, in the order to show them. */
  routes: string[];
  /** Badge size. Default 24. */
  size?: BadgeSize;
  /** Wider gaps, for a stop's own page. */
  wide?: boolean;
}

/** A stop's routes as a row of badges, wrapping as needed. */
export function RouteBadges({ routes, size = 24, wide = false }: RouteBadgesProps) {
  return <div className={wide ? 'badges wide' : 'badges'}>{routes.map(r => <RouteBadge key={r} route={r} size={size} />)}</div>;
}
