# Writing a pattern

A pattern is one file in `src/lib/layers/` and one entry in
`src/lib/catalog.js`. It is a GLSL fragment shader: the GPU runs it for every
pixel of the desktop, every frame the pattern is animating, at the monitor's
full resolution. The CPU's part of a frame is setting a handful of uniforms.

This page is the contract a pattern has to keep, and the conventions that make
patterns cheap, smooth and consistent with each other.

## The module

```js
// src/lib/layers/drizzle.js
export const glsl = `
vec4 drizzle(vec2 p) {
    ...
    return premultipliedColour;
}
`;

// Optional: the range the "Amount" setting may take for this pattern.
// Leave it out and the pattern gets no Amount control (u_density stays 1).
export const density = [0.25, 2];

// Optional, and only if the shader needs something worked out on the CPU
// once a frame (see "State" below).
export class State { ... }
```

- `glsl` must define a function named exactly like the catalog id, taking a
  pixel `p` and returning a **premultiplied** RGBA colour: `vec4(rgb * a, a)`.
  The engine clamps it, multiplies in the pattern's Brightness setting and
  draws it over whatever is below — the wallpaper and the patterns before it in
  catalog order — with ordinary premultiplied "over" blending.
- Every other function, constant or uniform the pattern declares is prefixed
  with its id (`drizzleDrop`, `drizzle_meteor`), because a pattern's GLSL is
  compiled alongside the shared prelude and names must not collide.
- The catalog entry adds `id`, `title` and `desc` (the prefs dialog shows the
  last two) and spreads the module in.

## Coordinates and sizes

- `p` is in **canvas pixels**, y down. The canvas is the monitor the actor is
  on, or — with *Span All Monitors* — the box around every monitor, so one
  picture runs across all of them. Its size is `u_canvas`.
- **Size things in `U`**: one pixel of a 1080-line screen. A glow of radius
  `6.0 * U` is 6 px on a 1080p monitor and 12 on a 4K one, so the pattern looks
  the same everywhere, only sharper where there are more pixels.
- **Vertical layout is a fraction of `u_canvas.y`** (a horizon at
  `0.62 * u_canvas.y`).
- **Anything with a horizontal frequency is measured in `DESIGN_W`**, the width
  of a 1920×1080 screen in the same units: `float x = p.x / DESIGN_W;` then
  `sin(x * TAU * 1.5)`. A wider canvas — an ultrawide, or two monitors spanned —
  then gets more of the pattern rather than a stretched copy of it.
- **Speeds are in U per second** (or `DESIGN_W` per second), never in fractions
  of the canvas, for the same reason.
- `u_seed` differs per monitor (so two screens side by side do not show the
  same particles) and is 0 when they are spanned (so they show one picture). Mix
  it into every hash.

## Time

`u_time` and `u_epoch` are this pattern's own time, already scaled by the global
speed and the pattern's Speed setting. Time comes in two parts because a
32-bit float cannot hold an hour of seconds to the precision one frame needs —
past that, motion steps unevenly. **Never write `u_epoch + u_time` for anything
that moves.** Use the helpers, which fold the epoch in safely:

| Helper | For | Example |
|---|---|---|
| `wphase(w)` | the argument of `sin(w·t)` | `sin(wphase(0.7) + phase)` |
| `scroll(v, period)` | `v·t` for something that repeats every `period` | a grid of cells sliding at `v` U/s, whose hash repeats every 64 cells |
| `lifecycle(period, phase)` | a life that repeats: `.x` counts lives, `.y` is 0→1 through this one | a particle that is born, lives and is reborn elsewhere |
| `drift(a)` | `a·t` as a distance through the noise below (which repeats every 256) | `vnoise(vec2(x, drift(0.05)))` |

The epoch is folded in by reducing `v·u_epoch` first, which is exact only when
the product is: a fast scroll with an arbitrary speed can jump by a few U once
an epoch after days of uptime. Rain, whose near streaks fall at 600 U/s, rounds
each speed to a whole number of U a second and makes its period a power of two,
so the product is a whole multiple of the period and nothing is lost. Do the
same for anything fast.

## The prelude

Every pattern can use:

- `hash12(vec2)`, `hash42(vec2)` — stable hashes, no bit operations.
- `vnoise(vec2)` — smooth value noise in [0, 1]; `fbm(vec2)` — three octaves.
  Both repeat every 256 units.
- `glow(d, r, rgb, core)` — a point of light at distance `d` (px) with radius
  `r` (px): a coloured halo and a white-hot core `core` of the radius wide,
  premultiplied. Neither part goes narrower than a pixel, so small lights glide
  across the pixel grid instead of flickering. Use it for any point of light.
- `line(d, width)` — antialiased coverage of a line `width` px wide at
  distance `d` from its centre. `segmentDistance(p, a, b)`.
- `U`, `DESIGN_W`, `TAU`, `u_canvas`, `u_density`, `u_seed`.

## Amount (`u_density`)

If the module exports `density = [low, high]`, the prefs dialog offers an
Amount setting in that range and `u_density` carries it, 1 being the pattern as
designed. What it means is the pattern's to decide — how many particles, how
dense a field — but it must be continuous (no jumps as it moves), and it must
not change the size or the look of what there is, only how much of it.
Typical ways: divide a cell size by `sqrt(u_density)`; compare a hash against
an occupancy threshold scaled by it; enable more slots of a fixed maximum.

## State

A `State` is only for what genuinely needs the whole picture at once, once a
frame — wave finds the peaks of its crest to put glints on, nebula moves its
clouds, starfield decides where a meteor is. It is constructed per monitor:

```js
new State({ width, height, unit, seed, rect })
```

`width`/`height` are the canvas's, `unit` is U, `seed` as `u_seed`, and `rect`
is this monitor's part of the canvas (`x, y, width, height`) — use it to hand
the shader only what can be seen on this monitor. `uniforms(t, density)`
returns `[name, components, values]` triples and is called once a frame with
the pattern's time in double precision.

**It must be a pure function of `t`** (and its constructor arguments): no
`Math.random`, no state carried from frame to frame. Two monitors spanning one
picture each run their own `State`, and they must agree; a monitor that sat
paused behind a window must pick up exactly where the other one is. Use
`seeded(n)` from `../layer.js` for fixed layouts, and derive per-event
randomness from a hash of the event's index.

## Making it cheap

Measure, don't guess: `make bench` (or `node scripts/shaders.mjs bench
PATTERN`) times each pattern on the real GPU, at 1080p unless told otherwise.
On the GTX 1080 this was written on, the patterns range from 0.13 ms (wave)
to 0.71 ms (constellation) a frame; a 240 Hz frame is 4.2 ms in all, shared with
every other pattern and the rest of the desktop. A new pattern should come in
under about 0.3 ms.

- **Let a pixel look at a few candidates, never all of them.** Put particles
  in a grid of cells (sparkles, starfield) or columns of slots (embers, bokeh)
  sized so a pixel only examines its own cell, or its own and its neighbours'.
  Nothing should loop over every particle per pixel.
- **Cull before the expensive part.** Work out where a particle is and return
  if it is out of reach before hashing its colour, flicker or wander. It pays
  when whole neighbourhoods of pixels take the exit together (sparkles,
  starfield and embers halved) — the GPU runs neighbouring pixels in lockstep,
  so where they do not, it runs both ways, and what counts is how much code a
  candidate has at all (fireflies: one `hash12` spread four ways beat
  `hash42`).
- **Branch on uniforms, not loop counts.** A loop that stops at a count the
  compiler cannot know is not unrolled; write the candidates out (the module is
  JavaScript, so generate them) and guard each, or each group of four, with a
  test on a uniform — every pixel takes the same way, so the test is nearly
  free. Nebula went from 0.42 ms to 0.32 that way.
- **No indexed local arrays.** An array written and read in loops is what
  compilers push out of registers into memory; constellation cost 2.1 ms that
  way and 0.8 ms as straight-line code (it generates its GLSL from JS for that
  reason). Uniform arrays are fine.
- **Loops have constant bounds** and conditions on uniforms rather than on
  per-pixel values where possible. Everything must compile as GLSL ES 1.00 —
  `make check` tries it.

## Checking it

```sh
node scripts/shaders.mjs check src/lib/layers/drizzle.js   # compiles in three GLSL dialects
node scripts/shaders.mjs bench src/lib/layers/drizzle.js   # GPU ms per 1080p frame
node scripts/shaders.mjs render src/lib/layers/drizzle.js --out drizzle.png \
    --frames 3 --step 0.5 [--density 2] [--span 2] [--bg Dark]
```

`render` draws frames of the pattern over a palette, as it appears on the
desktop, into one PNG, the frames stacked top to bottom — the quickest way to
see what a change did and how it moves. `--span 2` draws two monitors side by
side as one spanned canvas, with the seam marked, to check the picture runs
across it. Then look at it for real in the nested shell (`make nested`), where
the motion can be judged.
