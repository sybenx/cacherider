export interface PumpkinNight {
  /** The day of the month: 16. */
  date: number;
  /** 0 Monday … 6 Sunday: where it sits in its week's row (the first night's sets the row's start). */
  weekday: number;
  /** The shuttle's hours, short: '6–10'. Leave out for a night without one (its date struck through, 'none'). */
  hours?: string;
  /** Tonight: lit with a pumpkin-orange line along its top. */
  tonight?: boolean;
  /** For a screen reader: 'Tonight, Thursday 16 Oct, 6 PM–10 PM'. */
  label?: string;
}

export interface PumpkinNightsProps {
  /** The shuttle's nights from tonight to the last, every one, a night between without one included. */
  nights: PumpkinNight[];
}

/** The shuttle's nights as a little calendar, a week to a row, Monday first: each night's date and hours, tonight lit,
 *  a night without a shuttle (its Sundays) crossed out. */
export function PumpkinNights({ nights }: PumpkinNightsProps) {
  const lead = nights.length ? nights[0].weekday : 0;
  return (
    <div className="pk-cal" role="list" aria-label="Its nights">
      <div className="pk-wk" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <span key={i}>{x}</span>)}</div>
      <div className="pk-days">
        {Array.from({ length: lead }, (_, i) => <i key={'lead' + i}></i>)}
        {nights.map(n => (
          <div key={n.date} role="listitem" aria-label={n.label} className={'pk-day' + (n.tonight ? ' tonight' : '') + (n.hours ? '' : ' off')}>
            <b>{n.date}</b><span>{n.hours || 'none'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
