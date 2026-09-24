---
description: Show recent Wallpaper Engine output from the GNOME Shell journal
argument-hint: "[systemd time spec, e.g. '5 min ago' — defaults to 10 min]"
allowed-tools: Bash(./scripts/dev.sh logs:*)
---

Show what the extension has logged recently.

Time window requested: $ARGUMENTS

Run `./scripts/dev.sh logs "<window>"`, using the window above — or `10 min ago`
if it's empty. Anything systemd accepts works (`5 min ago`, `today`, `09:00`).

Summarise rather than dumping every line: how many enable cycles (under a
development link each logs `Enabled from ...`; the shipped code logs nothing on
success), any warnings, and any errors or stack traces in full. A pattern that
draws nothing but logs nothing is usually a shader that did not compile: say so,
and suggest `make check`.
Exceptions inside a GNOME extension only ever surface here, never in a terminal,
so this is the place to look when something silently does nothing.
