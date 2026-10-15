import type { ReactNode } from 'react';
// @ts-ignore: the app's own module, plain JS
import { ART, DECO, PERCH } from '../../../../app/views/pumpkin-art.js';

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
 * Pumpkin vines up both sides of what it frames (the map, in the app), with pumpkins in its top-left and bottom-right
 * corners: decoration over the content that never takes a tap. Frame the subject inside it, about 52 px in from the
 * sides on a phone, so the vines don't cover it.
 */
export function PumpkinVines({ children, height = '100%' }: PumpkinVinesProps) {
  return <div className="pk-frame" style={{ height }}>{children}<div dangerouslySetInnerHTML={{ __html: DECO }} /></div>;
}

/**
 * A vine along the top edge of a phone's pull-up card, leaves reaching up and pumpkins sitting on it at each end.
 * Put it first in the card; it rises above the card's edge into what's behind.
 */
export function PumpkinPerch() {
  return <div className="pk-perch-part" dangerouslySetInnerHTML={{ __html: PERCH }} />;
}
