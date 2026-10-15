import type { ReactNode } from 'react';
import { Icon } from './Icon';

export interface PageHeadProps {
  /** The page's name, in the heading type at 34 px: a stop's address, 'Transit Center', 'Pumpkin Walk'. */
  title: string;
  /** The small-caps line above: 'Stop 1043 · Logan', 'Seasonal · North Logan'. */
  eyebrow?: string;
  /** A line under the title, muted: 'Every 5 min · 6 PM–10 PM'. */
  sub?: string;
  /** A Back link above the head, with where it goes back to: 'Stops'. */
  back?: string;
  backHref?: string;
  /** Less room around it, for a sheet over the map. */
  tight?: boolean;
  /** Anything under the title: the stop's RouteBadges, links. */
  children?: ReactNode;
}

/** The top of a page: an optional Back link, an eyebrow, the title, and what follows it. Left-aligned, 16 px in. */
export function PageHead({ title, eyebrow, sub, back, backHref = '#', tight, children }: PageHeadProps) {
  return (
    <>
      {back ? <div className="backbar"><a className="btn btn-ghost" href={backHref}><Icon name="back" size={22} />{back}</a></div> : null}
      <div className={tight ? 'head tight' : 'head'}>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {sub ? <div className="muted">{sub}</div> : null}
        {children}
      </div>
    </>
  );
}
