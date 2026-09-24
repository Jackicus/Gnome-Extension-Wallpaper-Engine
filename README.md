# Wallpaper Engine

Animated, stackable patterns for the GNOME Shell desktop, drawn by the GPU
behind your windows — over your own wallpaper, a gradient in your accent colour,
a palette, or a picture of your choosing.

Based on the background engine from [`Slider-Overlay`](https://github.com/jackt/Slider-Overlay).

Built and tested on GNOME Shell 50. The metadata claims 45–50; 45–49 have not
been tested, and GNOME 51 needs a port — see
[docs/compatibility.md](docs/compatibility.md).

---

## Features

### Twelve patterns, in any combination
Drawn from the sky forward, each over the ones before it:

- **Nebula** — slow clouds of violet, teal and magenta light turning over each other.
- **Aurora** — curtains of polar light drifting across the sky, streaked with rays.
- **Contours** — topographic lines of a slowly shifting landscape, drawn in faint light.
- **Starfield** — layered stars drifting and twinkling, a galactic band, and now and then a meteor.
- **Wave** — the iconic ribbon: folded sheets of light with bright crests and glints.
- **Constellation** — drifting points that link up whenever two come close.
- **Sparkles** — drifting, depth-scaled specks with a soft flare.
- **Embers** — sparks rising from a warm glow, cooling from white through orange to red.
- **Fireflies** — warm lights wandering low and blinking on their own slow rhythms.
- **Bokeh** — large out-of-focus lights fading in, rising and fading out.
- **Snow** — flakes drifting down at several depths, swaying in a light wind.
- **Rain** — fine streaks falling at a slant, the near drops longer and faster.

Each one can be tuned on its own — brightness, speed and, for most, how much of
it there is — on top of an overall speed and opacity.

### Scenes
A whole look in one click: patterns, their tuning, and the background together.
Nine come built in (*Classic*, *Northern Lights*, *Deep Space*, *Campfire*,
*Snowfall*, *Rainy Evening*, *Summer Night*, …), and the look on screen can be
saved as a scene of your own.

### The background
- **Desktop Wallpaper** — the patterns over your own wallpaper.
- **Accent Color** — a gradient in GNOME's accent colour, following it as you
  change it (GNOME 47 and later; blue before that).
- **Color Gradient** — eight palettes (*Classic Blue*, *Dark*, *Red*, *Green*,
  *Gold*, *Aurora*, *Dusk*, *Nebula*).
- **Custom Picture** — any image.

The base is handed to the shell as its own wallpaper, so the overview, the
workspace switcher and anything that blurs the wallpaper show it too — and the
patterns follow into the overview and the workspace slide.

### Multiple monitors
Each monitor is paced at its own refresh rate. With **Span All Monitors**, the
patterns — and a gradient under them — become one picture running across every
monitor instead of a copy on each.

### Light on the machine
Every pattern is a GPU shader drawn at the monitor's full resolution; the
compositor's own thread only sets a few numbers a frame. On a GTX 1080 at
1920×1080, GPU time per frame:

| Pattern | ms | | Pattern | ms | | Pattern | ms |
|---|---|---|---|---|---|---|---|
| Nebula | 0.32 | | Wave | 0.11 | | Fireflies | 0.20 |
| Aurora | 0.30 | | Constellation | 0.65 | | Bokeh | 0.26 |
| Contours | 0.21 | | Sparkles | 0.14 | | Snow | 0.23 |
| Starfield | 0.18 | | Embers | 0.42 | | Rain | 0.15 |

A 60 Hz frame is 16.7 ms and a 240 Hz one 4.2 ms; the default wave and sparkles
take 0.26. On the CPU it is about 4% of a core at 60 FPS, whichever patterns are
on. `make bench` measures your own GPU.

The patterns rest — costing nothing — while fullscreen, maximized or tiled
windows cover the desktop, while the power saver mode is on or animations are
turned off, and, if you ask, on battery.

---

## Development

```bash
make link       # install as links into src/, for development, and enable
make reload     # apply edits to src/ in the running shell
make prefs      # open the preferences
make logs       # the extension's output in the shell journal

make check      # compile every pattern's shader offline, in each GLSL dialect
make bench      # time each pattern on the GPU
node scripts/shaders.mjs render PATTERN --out frames.png --frames 3

make nested         # a throwaway nested GNOME Shell, mirrored on your desktop
make preview        # ...and a screenshot of it
make nested-stop

make zip        # the package for extensions.gnome.org, in dist/
```

- [docs/patterns.md](docs/patterns.md) — how a pattern is written, and what makes one cheap.
- [docs/private-api.md](docs/private-api.md) — every place the extension reaches into shell internals.
- [docs/compatibility.md](docs/compatibility.md) — what has been tested where, and what to check on a new GNOME.
- [docs/publishing.md](docs/publishing.md) — building and submitting the extensions.gnome.org package.
