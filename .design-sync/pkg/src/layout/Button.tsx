import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface ButtonProps {
  /** primary: solid accent, condensed type, the page's one main action. secondary: hairline outline. ghost: text only (Back). Default primary. */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** An icon before the label, 18 px. */
  icon?: IconName;
  /** Full width. */
  block?: boolean;
  /** Taller: 52 px. */
  large?: boolean;
  disabled?: boolean;
  /** A link when given, else a button. */
  href?: string;
  onClick?: () => void;
  children: ReactNode;
}

/** The app's button: 44 px tall at least, square-ish 4 px corners. */
export function Button({ variant = 'primary', icon, block, large, disabled, href, onClick, children }: ButtonProps) {
  const cls = ['btn', 'btn-' + variant, block ? 'btn-block' : '', large ? 'btn-lg' : ''].filter(Boolean).join(' ');
  const inner = <>{icon ? <Icon name={icon} size={18} /> : null}{children}</>;
  return href
    ? <a className={cls} href={href} onClick={onClick}>{inner}</a>
    : <button type="button" className={cls} disabled={disabled} onClick={onClick}>{inner}</button>;
}
