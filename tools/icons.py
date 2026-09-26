#!/usr/bin/env python3
"""The app icon is icons/icon.svg, the stop-sign mark from the design: a bus-stop pole
whose sign is a clock (paper #f2f2f3, ink #1d1f20, steel #5980a6). icon-180 (Apple touch), icon-192 and
icon-512 were rendered from the square mark with favicongenerator.io. The browser-tab icons (icon.svg,
icon-96, favicon.ico with 16/32/48) are a rounded tile with the mark at 92% inside it (smaller reads as a "P" at 16 px), drawn from icon.svg. icon-512-maskable is drawn like the Android launcher foreground below, paper behind it: a
browser shortcut without a WebAPK (Vanadium on GrapheneOS) crops tighter than the web's 80%.
The Android app's launcher foreground (android/.../mipmap-*/ic_launcher_foreground.png) is the
mark alone on a transparent 108dp canvas, its farthest corners inside the 33dp safe circle, so a
round launcher doesn't clip the flag; icon_bg in colors.xml is the paper behind it."""
