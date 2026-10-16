import type { ReactNode } from 'react';
// @ts-ignore: the app's own module, plain JS
import { ART, DECO } from '../../../../app/views/pumpkin-art.js';

const Corners = () => <><i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i></>;

/**
 * The Pumpkin Walk's banner: dusk over North Logan's hills, a path with lanterns, five carved pumpkins glowing along
 * it, in a blueprint frame. Its colours are the night's in either theme. Full width at the top of the page.
 */
export function PumpkinDusk() {
  return <div className="pk-hero blueprint"><div className="pk-clip" dangerouslySetInnerHTML={{ __html: ART }} /><Corners /></div>;
}

export interface PumpkinVinesProps {
  /** What the vines frame: in the app, the map of the walk. */
  children?: ReactNode;
  /** The frame's height. Default 100%. */
  height?: number | string;
}

/**
 * A pumpkin vine along the bottom edge of the map's search box, the width of it (in the app, the map of the walk), its leaves
 * hanging, a smiling pumpkin and a plain one sitting on it: decoration over the content that never takes a tap. Both
 * sides and the card stay clear; frame the subject below it (about 92 px down on a phone).
 */
export function PumpkinVines({ children, height = '100%' }: PumpkinVinesProps) {
  return <div className="pk-frame" style={{ height }}>{children}<div dangerouslySetInnerHTML={{ __html: DECO }} /></div>;
}
