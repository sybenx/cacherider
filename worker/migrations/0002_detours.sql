-- The detour watch (src/detours.js): each way round the buses of a route have been seen to take, and each bus's
-- track between one minute's run and the next.
CREATE TABLE detours (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, olat REAL, olon REAL, blat REAL, blon REAL,
  path TEXT NOT NULL, streak INTEGER NOT NULL, trips INTEGER NOT NULL, first INTEGER NOT NULL, last INTEGER NOT NULL, along INTEGER);
CREATE TABLE state (k TEXT PRIMARY KEY, v TEXT NOT NULL);
