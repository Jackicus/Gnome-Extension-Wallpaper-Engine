---
description: Report install mode, shell state, and what the extension is currently drawing
allowed-tools: Bash(make status), Bash(./scripts/dev.sh status), Bash(gsettings:*)
---

Run `make status`, then read the current settings with
`gsettings get org.gnome.shell.extensions.wallpaper-engine <key>` (or
`list-recursively` for the lot), and report:

- **install** — a symlink to `src/` means dev mode (edits are live); a real
  directory means a copy that won't pick up edits until `make install` is re-run.
- **state** — `ACTIVE` is healthy. `doesn't exist` means the running shell never
  registered the UUID, which needs a log out / log back in, not a reload.
- **drawing** — `enabled-effects`, `background-mode` (and the palette or image
  path it implies), `speed`, `opacity`, `target-fps`.

If anything is off, say which command fixes it.
