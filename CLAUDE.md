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
line. `make bench` times each pattern on the real GPU.

`make` targets just delegate to `scripts/dev.sh` (install/reload/logs/prefs),
`scripts/nested.sh` (the nested shell) and `scripts/shaders.mjs` (check/bench).
New logic goes in those, not the Makefile.

## Layout

`src/` is an **exact mirror of the installed extension directory** — `make link`
symlinks it, so adding a file there ships it, with no list to keep in sync.

- `extension.js` — the shell's entry point; imports `lib/app.js`. GJS keeps a
  module for the life of the shell, keyed by URL, so under a **dev link** (a
  symlinked install) it copies `lib/` to a fresh
  `$XDG_RUNTIME_DIR/wallpaper-engine/lib-<stamp>/` on every enable, which is what
  makes `make reload` pick up edits. A real install imports `lib/` in place, once,
  so its shaders are compiled once and reused across every lock and unlock.
- `lib/app.js` — reads settings, builds one `MonitorRenderer` per monitor into
  `Main.layoutManager._backgroundGroup` (over the wallpaper, under the windows),
  rebuilds on `monitors-changed`, and pushes new state on any settings change.
- `lib/engine.js` — `MonitorRenderer`: a monitor-sized actor with one child per
  enabled pattern, each painted by that pattern's shader effect; the frame pacing;
  and `SceneClock`, the one animation clock every monitor shares.
- `lib/shader.js` — wraps a pattern's GLSL in a `Shell.GLSLEffect` class (one per
  pattern, compiled on first use and shared by every monitor), plus the GLSL every
  pattern gets: hashes, value noise, `glow()`, `line()`, and the time helpers.
- `lib/catalog.js` — **the single list of patterns**: id, title, description, and
  the layer module. `prefs.js` builds its switches from it and the engine draws in
  its order, so adding a pattern is a file in `lib/layers/`, an entry here, and
  nothing else.
- `lib/layers/*.js` — one pattern each. A module exports `glsl`, defining
  `vec4 <id>(vec2 p)` — a pixel in monitor coordinates to a premultiplied colour —
  and, only if the shader needs something worked out on the CPU each frame, a
  `State` class whose `uniforms(t)` returns `[name, components, values]` triples
  (wave's crest peaks, nebula's cloud positions, starfield's meteor).
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
- `lib/power.js` — a UPower proxy behind `pause-on-battery`, created only while
  that setting is on.
- `lib/palettes.js` — the named gradients for `color` mode. `lib/layer.js` — the
  seeded PRNG for what layers work out on the CPU.
- `prefs.js`, `schemas/` — the settings dialog and the keys behind it.

## How it fits together

Every pattern is a fragment shader, evaluated at the monitor's full resolution.
The CPU's part of a frame is setting a few uniforms, so what a pattern costs is
GPU time — `make bench`; on this desk's GTX 1080 at 1080p the lot is about 2.4ms
a frame, wave and sparkles 0.3ms — and the compositor thread does the same work
whichever patterns are on (about 4% of a core at 60 FPS in the nested shell).

`background-mode` picks the base — `desktop` (the system wallpaper, left alone),
`color` (a palette from `palettes.js`) or `image` (a file the user chose); in the
latter two `background.js` makes it the shell's own wallpaper. `enabled-effects`
is a list of catalog ids, drawn over that base in catalog order. `speed` scales
the clock and `opacity` is the monitor actor's opacity, which each shader
multiplies in.

**Pacing hangs off the paint.** Each pattern's effect calls back from
`vfunc_paint_target`; the first paint of a frame books the next repaint for
`divisor` refreshes later, half a refresh early so it lands on that frame, with
the rate read off the stage view the actor is on — so a 240Hz head and the 60Hz
one beside it are each paced in step with their own refresh. `target-fps` is 0
for every frame, -N for every Nth, or a positive rate rounded to the nearest
whole divisor (a rate that does not divide the refresh would judder). Time is
read at paint, so motion is even however the timer lands.

**A paint that never comes books nothing**, which is how the patterns rest: with
nothing to show, on battery with `pause-on-battery`, or — `pause-when-covered` —
while fullscreen, maximized or tiled windows hide the monitor's desktop. The
next paint of the desktop (a window moving away, the overview opening, a
setting changing) starts the frames again, so none of those cases needs a signal
of its own. Paints through a clone (the overview, the workspace slide) never
count as covered.

## Rules of thumb

- **Measure with `make bench`, one pattern at a time, before and after.** GPU
  compilers do surprising things, and intuition about which line costs has been
  wrong more often than right here.
- **No indexed local arrays in GLSL.** An array written and read in loops is what
  compilers push out of registers into memory: constellation cost 2.1ms a frame
  that way and 0.8ms written out as straight-line code (it generates the GLSL from
  JS for exactly this). Uniform arrays are fine.
- **Cull before the expensive part.** Most pixels are nowhere near most particles.
  Work out where a particle is and return early if it is out of reach, before
  hashing its colour, flicker or wander — that halved sparkles, starfield and
  embers. Aurora skips the rows no curtain can reach before evaluating any noise.
- **Let a pixel look at a few candidates, never all of them.** Particles live in
  a grid of cells (sparkles, starfield), columns of slots (embers, bokeh), or
  several drifting grids (constellation), sized so a pixel only has to examine its
  own cell or its neighbours'. Anything that loops over every particle per pixel
  does not scale.
- **Time comes in two parts.** A 32-bit float cannot hold an hour of seconds to
  the precision a frame needs, and past that motion steps unevenly. `u_time` is
  the seconds since the last 1024-second epoch, `u_epoch` the epoch; use the
  helpers in `shader.js` — `wphase(w)` for `sin(w·t)`, `scroll(v, period)` for a
  grid sliding at `v`, `lifecycle(period, phase)` for a repeating life, `drift(a)`
  for a walk through the (256-periodic) noise — never `u_epoch + u_time` directly
  for anything that moves. Anything computed in JS uses the double-precision `t`.
- **Size things in `U`**, one pixel of a 1080-line screen: a pattern then looks the
  same on any monitor, only sharper on a denser one. Positions are in monitor
  pixels (`p`, y down) or fractions of `u_res`.
- **Hashes are seeded, not random.** Every hash mixes in fixed constants (and
  `u_seed`, which differs per monitor so two screens side by side do not show the
  same sparkles); anything a `State` works out uses `seeded(n)`. A pattern's
  layout is then identical across reloads, which is the only way to tell a
  deliberate visual change from noise in a screenshot.
- **Glows are never narrower than a pixel.** `glow()` widens and dims a halo or a
  core that would be sub-pixel, so small lights glide across the pixel grid rather
  than flickering. Use it for any point of light.
- **One shader per pattern.** A shader is compiled for the worst case of all its
  code: all eight patterns in one ran at two thirds the speed of the same eight
  apart. Each pattern is its own actor and effect, drawn over the previous one.

## Gotchas

- **`extension.js` itself is cached for the life of the shell.** `make reload`
  picks up everything under `lib/` and the schema; an edit to `extension.js` or
  `metadata.json` needs a log out / log back in (or `stop` + `start` for the
  nested shell).
- **A new UUID needs a logout** — the shell only scans for unknown extension
  UUIDs at startup. `gnome-extensions info` saying the extension "doesn't exist"
  means exactly that, and no amount of reloading will fix it.
- **`make reload` is not optional.** Edits in `src/` are live on disk through the
  symlink, but the shell holds the old modules until the disable/enable cycle.
- **`glib-compile-schemas src/schemas` after editing the gschema**, then a full
  restart — `reload` alone does not recompile for the nested shell.
- **GType names outlive modules.** Under a dev link every enable loads `lib/`
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
