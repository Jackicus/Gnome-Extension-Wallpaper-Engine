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
- `lib/background.js` — **the base, handed to the shell instead of painted.**
  Every wallpaper the shell shows comes from one `BackgroundSource` reading
  `org.gnome.desktop.background`; this gives that source a `Gio.Settings` of our
  own — same schema, memory backend, so the user's dconf is untouched — pointed
  at a palette rendered to a PNG under the cache directory, or at their chosen
  picture. The gradient then appears wherever a wallpaper appears, including the
  copies other extensions blur, and the shell crossfades it when it changes.
- `lib/engine.js` — one monitor's canvases plus the frame clock. Two
  `St.DrawingArea`s: the **pattern** canvas that every layer draws into each
  frame, and a **base** below it that is now only a fallback, painted when
  `background.js` could not take the wallpaper over. They are separate so the
  pattern opacity does not fade the backdrop, and so a still gradient is not
  repainted thirty times a second.
- `lib/overview.js` — the same canvas, cloned into the overview's workspace
  previews, its thumbnail strip, and the workspace-slide strip. Without it the
  desktop goes bare the moment any of those appear.
- `lib/power.js` — a UPower proxy behind `pause-on-battery`, created only while
  that setting is on.
- `lib/catalog.js` — **the single list of patterns.** id, title, description,
  icon and constructor. `prefs.js` builds its toggles from it and `app.js`
  resolves ids through it, so adding a pattern is a file in `lib/layers/`, an
  entry here, and nothing else.
- `lib/layer.js` — the shared drawing kit: seeded PRNG, value noise / fbm,
  offscreen sprite helpers (`glowSprite`, `stamp`, `stampWithAlpha`), `lerp`,
  `countFor`. Layers are expected to use these rather than roll their own.
- `lib/layers/*.js` — one pattern each. A layer is a plain class with
  `draw(cr, scene)` and an optional `resize(w, h)`; `scene` is
  `{w, h, t, dt, scratch, scratchCr}`, with `t` already scaled by the speed
  setting and the scratch a canvas-sized buffer the engine lends out (see
  `addScaled`).
- `lib/palettes.js` — the named gradients for `color` mode.
- `prefs.js`, `schemas/` — the settings dialog and the keys behind it.

## How it fits together

`render-scale` decides how many pixels any of this costs: the pattern canvas is
drawn at that fraction of the monitor and scaled back up by the GPU. It is the
only lever that measurably changes CPU use (see the Rules below).

`background-mode` picks the base — `desktop` (the system wallpaper, left alone),
`color` (a palette from `palettes.js`) or `image` (a file the user chose). In the
latter two `background.js` makes it the shell's own wallpaper rather than
painting over it, so the base is already right in the overview, the app grid, the
thumbnails and the workspace slide, and the canvas over it carries only the
moving part. `enabled-effects` is a list of catalog ids, drawn over that base in
catalog order, so any combination stacks. `speed` advances the clock and
`opacity` is applied to the whole drawing area.

`target-fps` is a plain rate when positive and a **share of the monitor's own
refresh rate** at zero or below (0 every frame it shows, -2 every other one, -3
every third). The rate comes from the Clutter stage view the canvas is painted
on, so a 240Hz head and the 60Hz one beside it are paced separately. A share
rather than a number, because 60 frames a second on a 240Hz panel is one frame
held for four refreshes and the next for five, which reads as judder however fast
the panel is; an even division does not. The timer is deliberately set a little
fast and each frame painted against a deadline carried forward from the last one,
because GLib intervals are whole milliseconds and a quarter of 239.76Hz is 16.68
of them.

In that mode the clock also **gives frames back on its own**: once a second it
reads the shell's own CPU time out of `/proc/self/stat`, and if the wallpaper is
over `cpu-budget` -- its share of one core -- it raises the divisor, climbing
again when the load falls. Quick to give and slow to take, because at a divisor
of one or two there is no nudging it, only halving it. The ceiling is the shell's total rather than the time spent in the draw
handlers, because a repaint damages a whole monitor and the compositing and
texture upload that follow cost about as much again somewhere nothing here can
time them.

That governor follows the weather, and a stack of patterns being switched on is
not weather -- it is a step. So a **brake** sits in front of it, reading one
measured frame rather than a smoothed second: if that frame cannot fit the
budget at the rate currently being paced, the divisor jumps straight to one that
does, within a frame or two instead of the four seconds the governor needs to
have an opinion. It **leads only until the governor has ground truth** and then
stands down -- `/proc` is what the machine actually spent, where the brake has a
frame time and a guess at the compositing behind it, and two controllers with
different cost models on the same knob just take turns pulling it apart. It is
re-armed whenever a setting moves the cost, and overrides the stand-down for a
frame past `STALL_FRAME_US`, which is a stall the pointer feels.

The pair of them is also why `MIN_PACED_FPS` is no longer a floor on its own. It
is a floor on the *rate*, and what has to fit is the *cost*: with enough
patterns stacked, one frame can cost more than even 20 of them a second can
afford, and then the lowest rate the clock would allow itself still saturates
the compositor -- for ever, with the governor already at the bottom of its range.
So when a single frame is measurably that expensive the rate keeps falling, to
`MIN_SAFE_FPS`. The budget is divided by the monitor count first, since every
head runs the whole stack.

The clock skips frames instead of stopping when there is nothing to draw or when
`pause-on-fullscreen` sees a fullscreen window on that monitor.

## Rules of thumb

- **Everything here runs inside the compositor.** The draw handler fires as often
  as the display refreshes — 240 times a second on this desk — on the main loop;
  a slow one is a stuttering desktop. Precompute
  in `resize()`, stamp cached sprites rather than building gradients per particle,
  and scale particle counts with `countFor` so a 4K monitor doesn't cost 4× a 1080p one.
- **Never pace from the frame clock.** A `Clutter.Timeline` bound to the actor
  looks like the right way to follow a 240Hz display: in phase, per monitor, no
  rate to look up. But a running timeline asks the compositor for *every* frame
  the display can show, forever, whether we paint into it or not. Measured on a
  240Hz head: the same thirty paints a second cost **97% of a core** through a
  timeline against **32%** on a timer. Read the refresh rate off the stage view,
  then stay on a timer and let mutter sleep between our repaints.
- **The cost is pixels, not cleverness.** Measured on one 1600×900 monitor at 30
  FPS, aurora and nebula each took about half a core at full resolution, and
  micro-optimising them (fewer cairo calls, less per-frame allocation) moved that
  by at most 13%. Halving the render scale halved it. On 1920×1080, wave and
  sparkles together are 6.3ms of Cairo per frame at full scale, 4.4ms at 0.75 and
  2.9ms at 0.5 — against a 4.17ms budget for one frame of a 240Hz panel, which
  is why a high-refresh display needs the render scale down before it can have
  the frames. Before optimising a layer, measure — `/proc/<shell pid>/stat`
  over a ten-second window, one pattern at a time — rather than assuming the
  JS is what costs.
- **…except when cairo has no fast path for what you asked for**, which is the
  one thing that beats counting pixels. A bilinear upscale painted with
  `Operator.ADD` gets neither of the two fast paths it looks like it should — not
  the scaled-filter one, not the ADD one — and falls back to a general per-pixel
  loop: **8.1ms** of a 1440×810 frame, against 2.7ms for the same upscale with
  OVER. Split into a scaled OVER into a scratch buffer and an unscaled ADD of
  that buffer, the same pixels cost **1.7ms**, which took the eight-pattern stack
  from 33.5ms a frame to 23.5ms. `addScaled` in `layer.js` is that split, and the
  engine lends every layer one canvas-sized scratch buffer through `scene` for
  it. When a cairo call costs far more than its pixels should, suspect the
  operator-and-filter combination before suspecting the JS around it.
- **`resize(w, h)` is given the canvas size, not the monitor size.** They differ
  whenever the render scale does, and a layer that bakes a surface of exactly the
  canvas (starfield's band) or wraps against it (constellation) breaks if it
  assumes otherwise.
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
- **The shell's background is reached through private fields too** — a
  `BackgroundSource`'s `_settings` and `_backgrounds`, and `Background`'s
  `_emitChangedSignal`. `background.js` checks for them and says so in the log if
  they are gone; the base canvas in `engine.js` is what is left in that case, so
  the failure is a base that no longer follows into the overview, not a crash.
- **`_backgroundGroup` is private shell API**, and so is every path
  `overview.js` walks to reach the previews
  (`controls._workspacesDisplay._workspacesViews`, a workspace's `_background`
  and its `_backgroundGroup`, `controls._thumbnailsBox._thumbnails`) and the
  slide (`Main.wm._workspaceAnimation._prepareWorkspaceSwitch`). If the patterns
  stop appearing at all, check the first (`app.js` falls back to
  `global.window_group`); if they only vanish in the overview or during a
  workspace switch, check `overview.js`.
- **A canvas nothing can see costs nothing.** Clutter culls a fully covered
  actor, so the draw handler simply stops being called — which also means a CPU
  measurement taken while another extension covers the screen reads as zero.
- **Check the logs.** Exceptions inside an extension are swallowed into the shell
  journal, never a terminal; `make logs` is the only way to see them. A layer that
  throws is caught per-frame in `engine.js`, so a broken pattern looks like a
  missing one.
- **Never hardcode the repo path.** Resolve from `this.path` / `this.dir` — the
  extension has to work from a copied install, not just the symlink. Modules under
  `lib/` run from a staging copy, so don't derive paths from `import.meta.url` either.
