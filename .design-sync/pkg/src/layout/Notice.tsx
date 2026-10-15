import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface NoticeProps {
  /** Default 'info'; 'ban' for a detour, 'route' for buses on the road. */
  icon?: IconName;
  /** The line: muted, with the point in <b>. */
  children: ReactNode;
}

/** A one-line notice in a page's flow, an icon before it: '<b>2 detours</b> on routes 2 and 5 · details'. No box. */
export function Notice({ icon = 'info', children }: NoticeProps) {
  return <div className="notice"><Icon name={icon} size={16} /><span>{children}</span></div>;
}
