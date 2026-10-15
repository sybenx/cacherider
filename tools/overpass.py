"""Overpass, asked so that a bad answer is never published.

Overpass is often busy, so a tool tries a few times, the main server and a mirror in turn. Three answers are no
answer:
  - one with a `remark`: Overpass ran out of time or memory part way and sent what it had, with HTTP 200 (a query cut
    to one second came back with 10,052 elements and 'runtime error: Query timed out');
  - one from a snapshot of OpenStreetMap older than the file already published: the mirror has run days behind, and
    walknet.json went back and forth between two snapshots night after night, 890 ways coming and going (10-09 to
    10-15). Each file keeps the snapshot it was cut from (`osm`, osm3s.timestamp_osm_base), and the nightly commit
    looks past it, so a night with nothing new still makes no commit;
  - one far short of the file already published (`enough`).
Every try one of those, and the tool raises Unreachable: tools/upstream.py exits UNREACHABLE, and the workflow keeps
yesterday's file and stays green. A tool that breaks still fails as it breaks, and the run goes red.
"""
import json, sys, time, urllib.parse, urllib.request

SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
UNREACHABLE = 75   # sysexits' EX_TEMPFAIL: tried, couldn't; the last file stands (tools/upstream.py, the workflows)


class Unreachable(ConnectionError):
    """Nothing worth publishing came back: the last file stands."""


def published(path):
    """The file as it stands, the one riders have, or {}."""
    try:
        return json.load(open(path))
    except Exception:
        return {}


def query(q, ua, timeout, since='', tries=6):
    """A query's elements and the OSM snapshot they're from. since: the published file's snapshot; an answer from an
    older one is turned away, as one cut short is."""
    why = ''
    for n in range(tries):
        server = SERVERS[n % 2]
        try:
            req = urllib.request.Request(server, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': ua})
            doc = json.load(urllib.request.urlopen(req, timeout=timeout))
            base = (doc.get('osm3s') or {}).get('timestamp_osm_base', '')
            if doc.get('remark'):
                why = f"{server}: {doc['remark'][:160]}"
            elif since and base and base < since:
                why = f'{server}: OpenStreetMap as of {base}, older than the {since} already published'
            else:
                return doc.get('elements', []), base
        except Exception as ex:
            why = f'{server}: {ex}'
        print('Overpass:', why, '- again' if n + 1 < tries else '', file=sys.stderr)
        if n + 1 < tries: time.sleep(20 if n % 2 == 0 else 60)
    raise Unreachable(why)


def enough(n, was, what, share):
    """Turn away an answer far short of the file published: n now, was in it."""
    if was and n < share * was:
        raise Unreachable(f'only {n} {what} where the published file has {was}: not kept')
