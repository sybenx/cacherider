"""Run a tool that reads from somewhere else, and tell the workflow which way it went: 0, written; UNREACHABLE (75),
its source couldn't be reached or gave nothing worth keeping, and the last file stands; anything else, the tool
broke, and the run goes red so someone hears of it. Each step used to end `|| echo 'unreachable'`, which kept a tool
that crashed every night green, its data frozen and nobody told.

    python3 tools/upstream.py tools/usu.py [its arguments]
"""
import http.client, os, runpy, socket, ssl, sys, urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from overpass import UNREACHABLE, Unreachable

NET = (Unreachable, urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError, socket.timeout, ssl.SSLError)

if __name__ == '__main__':
    script = sys.argv[1]
    sys.argv = sys.argv[1:]
    try:
        runpy.run_path(script, run_name='__main__')
    except NET as ex:
        print(f'{os.path.basename(script)}: {ex}; the last file is kept', file=sys.stderr)
        sys.exit(UNREACHABLE)
