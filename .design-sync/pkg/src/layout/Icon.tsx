// @ts-ignore: the app's own module, plain JS
import { ICONS } from '../../../../app/icons.js';

/** Every icon the app draws (app/icons.js; build.mjs checks the two agree). */
export type IconName = 'clock' | 'pointer' | 'more' | 'mail' | 'sliders' | 'back' | 'share' | 'shareup' | 'house' | 'copy' | 'fwd' | 'search' | 'near' | 'calendar' | 'swap' | 'history' | 'route' | 'close' | 'list' | 'sun' | 'sunmoon' | 'stops' | 'map' | 'hub' | 'compass' | 'globe' | 'moon' | 'info' | 'pin' | 'ban' | 'down' | 'star' | 'plusSquare' | 'check' | 'up' | 'chevDown' | 'walk' | 'install' | 'pumpkin';

export interface IconProps {
  /** Which of the app's icons. */
  name: IconName;
  /** Width and height in px: 16 in a section head or notice, 18 in a button, 22 in the tab bar. Default 20. */
  size?: number;
  /** Stroke width. Default 1.5. */
  strokeWidth?: number;
}

/**
 * One of Cache Rider's line icons: a 24x24 stroke drawing in currentColor, so it takes the colour of the text around it.
 * Use it inside buttons, section heads, notices and tabs, never on its own as decoration.
 */
export function Icon({ name, size = 20, strokeWidth = 1.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />
  );
}
