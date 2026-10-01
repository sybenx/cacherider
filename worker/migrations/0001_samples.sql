-- Where the buses were, every 20 seconds while any are out: one row a sample, the buses as JSON
-- [label, trip, route, lat, lon, bearing, speed, ts]. Kept 14 days. Bus positions only: nothing of a rider's.
CREATE TABLE samples (t INTEGER PRIMARY KEY, buses TEXT NOT NULL);
