import type { CSSProperties, ReactNode } from 'react';

export interface BlueprintProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * The blueprint frame: a hairline box with crop marks at its corners, for the one or two objects a screen needs
 * edges on (the Pumpkin Walk's art, a nudge). Square corners. Everything else in the app is unboxed.
 */
export function Blueprint({ children, className, style }: BlueprintProps) {
  return (
    <div className={className ? 'blueprint ' + className : 'blueprint'} style={style}>
      {children}
      <i className="corner tl"></i><i className="corner tr"></i><i className="corner bl"></i><i className="corner br"></i>
    </div>
  );
}
