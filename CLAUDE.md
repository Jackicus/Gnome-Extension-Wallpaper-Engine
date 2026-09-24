# Wallpaper Engine

A GNOME Shell extension (UUID `wallpaper-engine@jackt`, shell 45–50) that paints
stackable animated patterns over the desktop — GPU shaders on actors sitting on
the wallpaper itself, no window. Settings are a Libadwaita prefs dialog.

## Seeing it

It draws on the desktop, so a visual change can only be confirmed by looking at
it. `make nested` starts a **headless nested GNOME Shell** with the extension
loaded and opens a **live mirror window on the real desktop**, so the user can
watch without logging out; `make preview` screenshots it. Read the
**`drive-extension` skill** before driving it. Keep one nested shell up across
edits and `reload` into it, and `make nested-stop` when finished.

Shader mistakes are silent in the shell — a pattern that fails to compile just
draws nothing — so **`make check` before reloading** after touching any GLSL: it
compiles every pattern offline, in each GLSL dialect Cogl may use, and names the
line. `make bench` times each pattern on the real GPU, and
`node scripts/shaders.mjs render PATTERN` draws frames of one to a PNG with no
shell at all — the quick loop for a pattern's look, and the one that works
while something else has the nested shell.

`make` targets just delegate to `scripts/dev.sh` (install/reload/logs/prefs/
pack), `scripts/nested.sh` (the nested shell) and `scripts/shaders.mjs`
(check/bench/render). New logic goes in those, not the Makefile.

`docs/` holds what is not about working on the code day to day:
**`docs/patterns.md` — the contract a pattern keeps, read it before writing or
changing one**; `docs/private-api.md` (every reach into shell internals);
`docs/compatibility.md` (what has been tested where); `docs/publishing.md`
(making the extensions.gnome.org zip).

## Layout

`src/` is **exactly what ships**: `make zip` packs it, `make install` copies it,
and adding a file there ships it, with no list to keep in sync. `make link`
builds the development install instead — a directory of links into `src/`,
except that its entry point is `scripts/dev-extension.js`.

- `extension.js` — the shipped entry point, and all it does is import
  `lib/app.js` and enable it. GJS keeps a module for the life of the shell, keyed
  by URL, which is right for an install: the shaders are compiled once and
  reused across every lock and unlock. For development it would mean an edit is
  never picked up without logging out, so the link's entry point,
  `scripts/dev-extension.js`, copies `lib/` to a fresh
  `$XDG_RUNTIME_DIR/wallpaper-engine/lib-<stamp>/` on every enable and imports
  from there — which is what makes `make reload` work. Nothing of it ships.
- `lib/app.js` — reads settings, works out what each monitor draws (its own
  canvas, or its part of one spanning all of them), builds one `MonitorRenderer`
  per monitor into `Main.layoutManager._backgroundGroup` (over the wallpaper,
  under the windows), rebuilds on `monitors-changed` and `span-monitors`, and
  pushes new state on any other settings change.
- `lib/engine.js` — `MonitorRenderer`: a monitor-sized actor with one child per
  enabled pattern, each painted by that pattern's shader effect and faded in and
  out as it is switched; the frame pacing; and `SceneClock`, one clock per
  pattern (for its own speed), shared by every monitor.
- `lib/shader.js` — wraps a pattern's GLSL in a `Shell.GLSLEffect` class (one per
  pattern, compiled on first use and shared by every monitor), plus the GLSL every
  pattern gets: hashes, value noise, `glow()`, `line()`, and the time helpers.
- `lib/catalog.js` — **the single list of patterns**: id, title, description, and
  the layer module, in the order they are drawn (sky first, weather last).
  `prefs.js` builds its rows from it and the engine draws in its order, so adding
  a pattern is a file in `lib/layers/`, an entry here, and nothing else.
- `lib/layers/*.js` — one pattern each, keeping the contract in
  `docs/patterns.md`: `glsl` defining `vec4 <id>(vec2 p)`, a canvas pixel to a
  premultiplied colour; `density`, the range of its Amount setting, if it has
  one; and, only if the shader needs something worked out on the CPU each frame,
  a `State` whose `uniforms(t, density)` is a pure function of time (wave's
  crest peaks, nebula's cloud positions, starfield's meteor).
- `lib/background.js` — **the base, handed to the shell instead of painted.**
  Every wallpaper the shell shows comes from one `BackgroundSource` reading
  `org.gnome.desktop.background`; this gives that source a `Gio.Settings` of our
  own — same schema, memory backend, so the user's dconf is untouched — pointed
  at a palette rendered to a PNG under the cache directory, or at their chosen
  picture. The base then appears wherever a wallpaper appears, including the
  copies other extensions blur, and the shell crossfades it when it changes.
- `lib/overview.js` — the patterns cloned into the overview's workspace previews,
  its thumbnail strip, and the workspace-slide strip. Without it the desktop goes
  bare the moment any of those appear.
- `lib/system.js` — the system's say: UPower's `OnBattery` (for
  `pause-on-battery`), power-profiles-daemon's active profile, and St's
  `enable-animations`.
- `lib/scenes.js` — the built-in scenes and saving, applying and matching them;
  used only by prefs. A scene is just the values of `SCENE_KEYS`.
- `lib/palettes.js` — the named gradients for `color` mode, and the accent
  colours for `accent`. `lib/layer.js` — the seeded PRNG for what layers work
  out on the CPU.
- `prefs.js`, `schemas/` — the settings dialog (Scenes, Patterns, Background,
  Performance) and the keys behind it.

## How it fits together

Every pattern is a fragment shader, evaluated at the monitor's full resolution.
The CPU's part of a frame is setting a few uniforms, so what a pattern costs is
GPU time — `make bench`; on this desk's GTX 1080 at 1080p the patterns take
0.11–0.65 ms a frame each, all twelve together 3.2 ms and wave and sparkles
0.26 — and the compositor thread does the same work whichever patterns are on
(about 4% of a core at 60 FPS in the nested shell).

`background-mode` picks the base — `desktop` (the system wallpaper, left alone),
`accent` (a gradient in GNOME's accent colour, which it follows as it changes;
blue before GNOME 47), `color` (a palette from `palettes.js`) or `image` (a file
the user chose); in all but the first `background.js` makes it the shell's own
wallpaper, spanned across the monitors when the patterns are. `enabled-effects`
is a list of catalog ids, drawn over that base in catalog order, each tuned by
`pattern-tuning` (brightness, speed, Amount, as multipliers of its design).
`speed` scales every clock and `opacity` is the monitor actor's opacity, which
each shader multiplies in.

With `span-monitors`, every monitor draws its part of one canvas — the box
around them all, sized by the primary monitor, one seed — and because every
`State` is a pure function of time and every clock is shared, the parts agree
without talking to each other. Scenes are prefs-only: applying one writes a
handful of keys, and the extension simply follows them.

**Pacing hangs off the paint.** Each pattern's effect calls back from
`vfunc_paint_target`; the first paint of a frame books the next repaint for
`divisor` refreshes later, half a refresh early so it lands on that frame, with
the rate read off the stage view the actor is on — so a 240Hz head and the 60Hz
one beside it are each paced in step with their own refresh. `target-fps` is 0
for every frame, -N for every Nth, or a positive rate rounded to the nearest
whole divisor (a rate that does not divide the refresh would judder). Time is
read at paint, so motion is even however the timer lands.

**A paint that never comes books nothing**, which is how the patterns rest: with
nothing to show, while the power-saver profile is on or animations are off
(always — those are the user's choices for the whole system), on battery with
`pause-on-battery`, or — `pause-when-covered` — while fullscreen, maximized or
tiled windows hide the monitor's desktop. The
next paint of the desktop (a window moving away, the overview opening, a
setting changing) starts the frames again, so none of those cases needs a signal
of its own. Paints through a clone (the overview, the workspace slide) never
count as covered.

## Rules of thumb

The rules for writing a pattern — coordinates and `U`, the time helpers, Amount,
`State`, and what makes a shader cheap — are in **`docs/patterns.md`**; read it
before touching a layer. The ones that are about everything else:

- **Measure with `make bench`, one pattern at a time, before and after.** GPU
  compilers do surprising things, and intuition about which line costs has been
  wrong more often than right here: indexed local arrays (constellation, 2.1 ms →
  0.8 as straight-line code), loops with runtime counts (nebula, 0.42 → 0.32
  unrolled behind uniform tests), a second noise octave that was worth its
  0.06 ms (aurora's rays).
- **One shader per pattern.** A shader is compiled for the worst case of all its
  code: all eight patterns in one ran at two thirds the speed of the same eight
  apart. Each pattern is its own actor and effect, drawn over the ones before it.
- **Every `State` is a pure function of time.** Spanned monitors each run their
  own, and a monitor that sat paused must pick up exactly where the others are;
  anything random comes from a hash of an index (starfield's meteors are one per
  eight-second slot).
- **Look before calling it done.** `render` is the fast loop; the nested shell,
  with its mirror, is where motion and the overview are judged, and
  `start --monitors 2` is the only way to see spanning or the seam between two
  monitors.

## Gotchas

- **The entry point itself is cached for the life of the shell.** `make reload`
  picks up everything under `lib/` and the schema; an edit to
  `scripts/dev-extension.js` or `metadata.json` needs a log out / log back in
  (or `stop` + `start` for the nested shell). `src/extension.js` only runs from
  an install or the zip.
- **Never `gnome-extensions install --force` over the link.** Its recursive
  delete follows symlinks, into `src/`. `make uninstall` first, which removes
  only the links.
- **A new UUID needs a logout** — the shell only scans for unknown extension
  UUIDs at startup. `gnome-extensions info` saying the extension "doesn't exist"
  means exactly that, and no amount of reloading will fix it.
- **`make reload` is not optional.** Edits in `src/` are live on disk through the
  symlink, but the shell holds the old modules until the disable/enable cycle.
- **`glib-compile-schemas src/schemas` after editing the gschema**, then a full
  restart — `reload` alone does not recompile for the nested shell.
- **GType names outlive modules.** Under the link every enable loads `lib/`
  afresh, so `shader.js` names each load's classes apart; a class registered with
  a fixed name fails the second time with "already registered", and that pattern
  simply does not appear.
- **The shell's background is reached through private fields** — a
  `BackgroundSource`'s `_settings` and `_backgrounds`, and `Background`'s
  `_emitChangedSignal`. `background.js` checks for them and says so in the log if
  they are gone; the patterns still draw, over the user's own wallpaper. Every
  write to those settings makes the shell rebuild and crossfade every wallpaper,
  and so does touching the file it shows — hence `update()` leaving an unchanged
  base alone, and no mtime games in the palette cache.
- **`_backgroundGroup` is private shell API**, and so is every path
  `overview.js` walks to reach the previews
  (`controls._workspacesDisplay._workspacesViews`, a workspace's `_background`
  and its `_backgroundGroup`, `controls._thumbnailsBox._thumbnails`) and the
  slide (`Main.wm._workspaceAnimation._prepareWorkspaceSwitch`). If the patterns
  stop appearing at all, check the first; if they only vanish in the overview or
  during a workspace switch, check `overview.js`.
- **Do not trust `Main.overview.visible` on its own.** In the nested shell it has
  read true on a plain desktop; that is why pausing asks whether a paint came
  through a clone instead, and why `overview.js` clears its clones before adding
  them.
- **An actor with a shader effect paints a pixel's margin past its edge.** Two
  monitors side by side then both paint the column at the seam, which shows as
  a bright line through anything drawn there; `MonitorRenderer` clips its actor
  to its allocation for that reason.
- **Clutter only culls the background when windows cover all of it** — and a
  panel is not a window, so behind a maximized window the strip under the top bar
  keeps the whole monitor repainting. That is what `pause-when-covered` is for.
  It also means a CPU reading taken while something covers the desktop is
  measuring something else.
- **Check the logs.** Exceptions inside an extension are swallowed into the shell
  journal, never a terminal; `make logs` is the only way to see them. A shader
  that fails to compile shows up there as a Cogl warning at best — `make check`
  first.
- **Never hardcode the repo path.** Resolve from `this.path` / `this.dir` — the
  extension has to work from a copied install, not just the symlink. Modules under
  `lib/` may run from a staging copy, so don't derive paths from
  `import.meta.url` either.
