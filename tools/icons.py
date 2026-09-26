#!/usr/bin/env python3
"""The app icon is icons/icon.svg, the stop-sign mark from the design: a bus-stop pole
whose sign is a clock (paper #f2f2f3, ink #1d1f20, steel #5980a6). favicon.ico, icon-96,
icon-180 (Apple touch), icon-192 and icon-512 were rendered from that SVG with
favicongenerator.io. icon-512-maskable keeps the mark inside the middle 80% for
Android's shaped launchers and was rasterised separately; regenerate it if the mark changes.
The Android app's launcher foreground (android/.../mipmap-*/ic_launcher_foreground.png) is the
mark alone on a transparent 108dp canvas, its farthest corners inside the 33dp safe circle, so a
round launcher doesn't clip the flag; icon_bg in colors.xml is the paper behind it."""
