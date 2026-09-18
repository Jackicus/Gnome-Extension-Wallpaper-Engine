# Wallpaper Engine

A GNOME Shell extension (UUID `wallpaper-engine@jackt`, shell 45–50) that paints
stackable animated patterns over the desktop — a Cairo canvas sitting on the
wallpaper itself, no window. Settings are a Libadwaita prefs dialog.

## Seeing it

It draws on the desktop, so a visual change can only be confirmed by looking at
it. `make nested` starts a **headless nested GNOME Shell** with the extension
loaded and opens a **live mirror window on the real desktop**, so the user can
watch without logging out; `make preview` screenshots it. Read the
**`drive-extension` skill** before driving it. Keep one nested shell up across
edits and `reload` into it, and `make nested-stop` when finished.

`make` targets just delegate to `scripts/dev.sh` (install/reload/logs/prefs) and
`scripts/nested.sh` (the nested shell). New logic goes in those, not the Makefile.

## Layout

`src/` is an **exact mirror of the installed extension directory** — `make link`
symlinks it, so adding a file there ships it, with no list to keep in sync.

- `extension.js` — the shell's entry point. It copies `lib/` into
  `$XDG_RUNTIME_DIR/wallpaper-engine/lib-<stamp>/` and imports `app.js` from
  there. GJS caches modules by URL for the life of the shell, so a fresh
  directory per enable is what makes `make reload` pick up edits without a logout.
- `lib/app.js` — reads settings, builds one `MonitorRenderer` per monitor and
  parents the lot into `Main.layoutManager._backgroundGroup` (over the wallpaper,
  under the windows). Rebuilds on `monitors-changed`; pushes new state to the
  renderers on any settings change.
- `lib/engine.js` — one monitor's `St.DrawingArea` plus the frame clock. It paints
  the base layer (palette gradient, or clears to transparent so the real wallpaper
  or the custom image behind shows through), then every active layer in order.
- `lib/catalog.js` — **the single list of patterns.** id, title, description,
  icon and constructor. `prefs.js` builds its toggles from it and `app.js`
  resolves ids through it, so adding a pattern is a file in `lib/layers/`, an
  entry here, and nothing else.
- `lib/layer.js` — the shared drawing kit: seeded PRNG, value noise / fbm,
  offscreen sprite helpers (`glowSprite`, `stamp`, `stampWithAlpha`), `lerp`,
  `countFor`. Layers are expected to use these rather than roll their own.
- `lib/layers/*.js` — one pattern each. A layer is a plain class with
  `draw(cr, scene)` and an optional `resize(w, h)`; `scene` is `{w, h, t, dt}`,
  with `t` already scaled by the speed setting.
- `lib/palettes.js` — the named gradients for `color` mode.
- `prefs.js`, `schemas/` — the settings dialog and the keys behind it.

## How it fits together

`background-mode` picks the base — `desktop` (transparent, the system wallpaper
shows through), `color` (a palette from `palettes.js`) or `image` (a file, set as
the container's `background-image`). `enabled-effects` is a list of catalog ids,
drawn over that base in catalog order, so any combination stacks. `speed`
advances the clock, `opacity` is applied to the whole drawing area, and
`target-fps` is the timeout interval. The clock skips frames instead of stopping
when there is nothing to draw or when `pause-on-fullscreen` sees a fullscreen
window on that monitor.

## Rules of thumb

- **Everything here runs inside the compositor.** The draw handler fires up to 60
  times a second on the main loop; a slow one is a stuttering desktop. Precompute
  in `resize()`, stamp cached sprites rather than building gradients per particle,
  and scale particle counts with `countFor` so a 4K monitor doesn't cost 4× a 1080p one.
- **Layers are seeded, not random.** `seeded(n)` with a fixed number keeps a
  pattern's layout identical across reloads, which is the only way to tell a
  deliberate visual change from noise in a screenshot.
- **Coordinates are normalised.** Particles live in 0–1 and multiply by `s.w`/`s.h`
  at draw time, so nothing has to be rebuilt when a monitor changes size.
- **Always `cr.save()` / `cr.restore()` around a layer's drawing**, and restore any
  `setOperator` — the engine shares one context between every layer in the stack.

## Gotchas

- **`extension.js` itself is cached for the life of the shell.** `make reload`
  picks up everything under `lib/`, the stylesheet and the schema; an edit to
  `extension.js` or `metadata.json` needs a log out / log back in (or `stop` +
  `start` for the nested shell).
- **A new UUID needs a logout** — the shell only scans for unknown extension
  UUIDs at startup. `gnome-extensions info` saying the extension "doesn't exist"
  means exactly that, and no amount of reloading will fix it.
- **`make reload` is not optional.** Edits in `src/` are live on disk through the
  symlink, but the shell holds the old modules until the disable/enable cycle.
- **`glib-compile-schemas src/schemas` after editing the gschema**, then a full
  restart — `reload` alone does not recompile for the nested shell.
- **St CSS is not web CSS.** No flexbox, grid, `calc()` or CSS variables; layout
  is done in JS. Almost nothing here is styled anyway — the pixels come from Cairo.
- **`_backgroundGroup` is private shell API.** If the patterns stop appearing
  after a GNOME upgrade, that is the first thing to check (`app.js` falls back to
  `global.window_group`).
- **Check the logs.** Exceptions inside an extension are swallowed into the shell
  journal, never a terminal; `make logs` is the only way to see them. A layer that
  throws is caught per-frame in `engine.js`, so a broken pattern looks like a
  missing one.
- **Never hardcode the repo path.** Resolve from `this.path` / `this.dir` — the
  extension has to work from a copied install, not just the symlink. Modules under
  `lib/` run from a staging copy, so don't derive paths from `import.meta.url` either.
