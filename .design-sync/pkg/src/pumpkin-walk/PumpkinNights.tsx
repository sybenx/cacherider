export interface PumpkinNight {
  /** 'Tonight', or the day: 'Fri'. */
  day: string;
  /** '16 Oct'. */
  date: string;
  /** The shuttle's hours: '6–10 PM'. Leave out for a night without one ('No shuttle', muted). */
  hours?: string;
  /** Tonight: lit with a pumpkin-orange line along its top. */
  tonight?: boolean;
}

export interface PumpkinNightsProps {
  /** The shuttle's nights from tonight to the last, a night between without one included. */
  nights: PumpkinNight[];
}

/** The shuttle's nights as a grid of cells (about 92 px each, wrapping): day, date and hours, tonight lit. */
export function PumpkinNights({ nights }: PumpkinNightsProps) {
  return (
    <div className="pk-nights">
      {nights.map(n => (
        <div key={n.day + n.date} className={'pk-night' + (n.tonight ? ' tonight' : '') + (n.hours ? '' : ' off')}>
          <span className="d">{n.day}</span><span className="dt">{n.date}</span><span className="h">{n.hours || 'No shuttle'}</span>
        </div>
      ))}
    </div>
  );
}
