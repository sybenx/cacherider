/** A route as Cache Valley Transit District's timetable gives it: its short name (the badge), colours and long name. */
export interface Route { short: string; color: string; text: string; long: string }

/** CVTD's routes, as data/cvtd.json has them (October 2026): what a RouteBadge draws when given only a route's name. */
export const cvtdRoutes: Record<string, Route> = {
  '1': { short: '1', color: 'FF842C', text: '000000', long: 'Route 01' },
  '2': { short: '2', color: 'F60017', text: '000000', long: 'Route 02' },
  '3': { short: '3', color: 'FA0561', text: '000000', long: 'Route 03' },
  '5': { short: '5', color: 'BA0A7A', text: 'FFFFFF', long: 'Route 05' },
  '6': { short: '6', color: '783A9B', text: 'FFFFFF', long: 'Route 06' },
  '7': { short: '7', color: '4D3F9E', text: 'FFFFFF', long: 'Route 07' },
  '8': { short: '8', color: '8EBE5B', text: 'FFFFFF', long: 'Route 08' },
  '9': { short: '9', color: '05674E', text: 'FFFFFF', long: 'Route 09' },
  '11': { short: '11', color: '066A40', text: 'FFFFFF', long: 'Route 11' },
  '12': { short: '12', color: 'DC5331', text: '000000', long: 'Route 12' },
  '15': { short: '15', color: '780662', text: 'FFFFFF', long: 'Route 15' },
  '16 AM': { short: '16 AM', color: '023465', text: 'FFFFFF', long: 'Route 16 AM' },
  '16 PM': { short: '16 PM', color: '004D93', text: 'FFFFFF', long: 'Route 16 PM' },
  G: { short: 'G', color: '94CB49', text: '000000', long: 'Green Loop' },
  B: { short: 'B', color: '5BB6EB', text: '000000', long: 'Blue Loop' },
  'Pumpkin Walk': { short: 'Pumpkin Walk', color: 'FF4112', text: '7221FF', long: 'Pumpkin Walk Seasonal' },
};
