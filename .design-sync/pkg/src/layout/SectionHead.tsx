import { Icon, type IconName } from './Icon';

export interface SectionHeadProps {
  /** The section's name: shown in muted condensed capitals. */
  title: string;
  /** An icon before it, 16 px. */
  icon?: IconName;
  /** A note or link at the right: 'Stop 8000', 'Edit'. */
  note?: string;
  noteHref?: string;
}

/** A section's heading over a list: muted condensed small caps, an optional icon, and a note or link at the right. */
export function SectionHead({ title, icon, note, noteHref }: SectionHeadProps) {
  if (!note) return <div className="section">{icon ? <Icon name={icon} size={16} /> : null}{title}</div>;
  return (
    <div className="section between">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{icon ? <Icon name={icon} size={16} /> : null}{title}</span>
      {noteHref ? <a className="note" href={noteHref}>{note}</a> : <span className="note">{note}</span>}
    </div>
  );
}
