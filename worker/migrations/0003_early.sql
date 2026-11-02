-- Buses gone by a timed stop early (src/early.js): one row a trip's timed stop, as first seen past it. Kept 14 days.
-- Bus numbers and timetable places only: nothing of a rider's.
CREATE TABLE early (day TEXT NOT NULL, trip TEXT NOT NULL, bus TEXT NOT NULL, route TEXT NOT NULL, stop TEXT NOT NULL,
  due INTEGER NOT NULL, seen INTEGER NOT NULL, early INTEGER NOT NULL, PRIMARY KEY (day, trip, stop));
