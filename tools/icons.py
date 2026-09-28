#!/usr/bin/env python3
"""The app icon is icons/icon.svg, the stop-sign mark from the design: a bus-stop pole
whose sign is a clock (paper #f2f2f3, ink #1d1f20, steel #5980a6). icon-180 (Apple touch), icon-192 and
icon-512 were rendered from the square mark with favicongenerator.io. icon-96 is a full paper square with the mark at 76%, so a
search engine's circle crop (Google shows favicons round) keeps all of it. The tab icons (icon.svg,
favicon.ico with 16/32/48) are a rounded tile with the mark at 92% inside it (smaller reads as a "P" at 16 px), drawn from icon.svg. icon-512-maskable is drawn like the Android launcher foreground below, paper behind it: a
browser shortcut without a WebAPK (Vanadium on GrapheneOS) crops tighter than the web's 80%.
The Android app's launcher foreground (android/.../mipmap-*/ic_launcher_foreground.png) is
icon-android-foreground.svg: the mark alone at 44% of the 108dp canvas, its farthest corners 120 of
the 132 px (at 4x) the 66dp safe circle allows, so a round launcher leaves the flag and the stand whole;
icon_bg in colors.xml is the paper behind it. The legacy ic_launcher.png (Android 7) is
icon-android-legacy.svg, the mark at 78% on a rounded paper tile. The Play listing's icon is
icon-512-play.svg, the mark at 66% on paper: Play rounds a fifth off every corner.
Without an SVG renderer installed, these were rasterised with macOS QuickLook
(qlmanage -t -s 432 icons/icon-android-foreground.svg -o DIR) and resampled with sips."""
