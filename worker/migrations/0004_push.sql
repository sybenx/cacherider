-- Phones that asked to be told of new service notices (src/push.js). A phone's push address and its two keys, as its
-- browser hands them over, and the last round of notices sent to it. Nothing else of a rider's: no name, no stops, no
-- location. Turning the switch off, or the browser saying the address is gone, deletes the row.
CREATE TABLE push_subs (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, sent INTEGER NOT NULL, made INTEGER NOT NULL);
-- Every notice seen, and the round it was first seen in; round 0 is what was up when this began (never sent).
CREATE TABLE push_alerts (id TEXT PRIMARY KEY, round INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, seen INTEGER NOT NULL);
