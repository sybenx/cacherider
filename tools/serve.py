#!/usr/bin/env python3
"""A dev server that behaves like the real hosts: byte ranges for the tiles,
and no caching, so an edit shows on the next reload.

  python3 tools/serve.py 8794
"""
import os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def do_GET(self):
        path = self.translate_path(self.path)
        rng = self.headers.get('Range')
        if not rng or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        m = re.match(r'bytes=(\d+)-(\d*)', rng)
        start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_response(416); self.send_header('Content-Range', 'bytes */%d' % size); self.end_headers(); return
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        with open(path, 'rb') as f:
            f.seek(start)
            self.wfile.write(f.read(end - start + 1))

    def log_message(self, fmt, *args):
        if '206' not in str(args): super().log_message(fmt, *args)

Handler.extensions_map.update({'.mjs': 'text/javascript', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.pmtiles': 'application/octet-stream', '.pbf': 'application/x-protobuf', '.woff2': 'font/woff2'})
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8794
print('serving', os.path.normpath(ROOT), 'on http://127.0.0.1:%d' % port)
ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
