#!/usr/bin/env python3
"""Draw the app icon: an ink ground, a steel badge, three hairline rows — a
timetable, in the design's own materials. Pure Python, no image library."""
import os, struct, zlib

INK, STEEL, PAPER = (29, 31, 32), (89, 128, 166), (242, 242, 243)
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')

def png(path, size, pixels):
    raw = b''.join(b'\x00' + bytes(c for px in row for c in px) for row in pixels)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def draw(size, maskable=False):
    s = size
    inset = 0 if maskable else 0
    badge = (int(s * (0.28 if maskable else 0.2)), int(s * (0.72 if maskable else 0.8)))
    r = int(s * 0.06)
    rows = [0.40, 0.50, 0.60] if not maskable else [0.42, 0.50, 0.58]
    bar = max(2, int(s * 0.03))
    px = []
    for y in range(s):
        row = []
        for x in range(s):
            c = INK
            bx0, bx1 = badge
            if bx0 <= x < bx1 and bx0 <= y < bx1:
                # rounded corners
                dx = max(bx0 + r - x, x - (bx1 - 1 - r), 0); dy = max(bx0 + r - y, y - (bx1 - 1 - r), 0)
                if dx * dx + dy * dy <= r * r:
                    c = STEEL
                    for f in rows:
                        cy = int(s * f)
                        if cy - bar // 2 <= y < cy + bar - bar // 2 and bx0 + int(s * 0.08) <= x < bx1 - int(s * 0.08):
                            c = PAPER
            row.append(c)
        px.append(row)
    return px

os.makedirs(OUT, exist_ok=True)
png(os.path.join(OUT, 'icon-192.png'), 192, draw(192))
png(os.path.join(OUT, 'icon-512.png'), 512, draw(512))
png(os.path.join(OUT, 'icon-512-maskable.png'), 512, draw(512, True))
open(os.path.join(OUT, 'icon.svg'), 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#1d1f20"/>'
    '<rect x="20" y="20" width="60" height="60" rx="6" fill="#5980a6"/>'
    '<rect x="28" y="38.5" width="44" height="3" fill="#f2f2f3"/><rect x="28" y="48.5" width="44" height="3" fill="#f2f2f3"/><rect x="28" y="58.5" width="44" height="3" fill="#f2f2f3"/></svg>')
print('icons written to', os.path.normpath(OUT))
