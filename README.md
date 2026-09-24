# Wallpaper Engine

An animated, stackable background engine for GNOME Shell (Shell versions 45–50).

Render dynamic, smooth, and layered animations directly over your existing desktop wallpaper, over stylish color palettes, or over a custom picture.

Based on the background engine from [`Slider-Overlay`](https://github.com/jackt/Slider-Overlay).

---

## Features

### 1. Stackable Animated Patterns
Enable any combination of patterns to mix and match simultaneously:
- **Wave**: The iconic PS3 ribbon — dual folded sheets of light with breathing envelopes, twists, crest highlights, and glints.
- **Sparkles**: Drifting, depth-scaled specks with a soft flare.
- **Nebula**: Slow swirling clouds of violet, teal, and magenta light turning over each other.
- **Aurora**: Dancing curtains of northern polar lights with procedural vertical ray noise.
- **Starfield**: Deep night sky with depth-layered stars, a diagonal galactic band, and meteors.
- **Embers**: Rising forge sparks with turbulent noise eddies cooling from white-hot to orange to red.
- **Bokeh**: Large out-of-focus lights fading in, rising softly through the frame, and fading out.
- **Constellation**: Drifting nodes that dynamically weave and unweave a proximity mesh.

### 2. Flexible Base Layers
- **Desktop Wallpaper (Overlay)**: Renders patterns with transparency directly over your existing GNOME wallpaper.
- **Color Gradient**: Renders patterns over 8 handcrafted palettes (*Classic Blue*, *Dark*, *Red*, *Green*, *Gold*, *Aurora*, *Dusk*, *Nebula*).
- **Custom Picture**: Choose your own background image via a file picker.

### 3. Preferences Dialog (Libadwaita)
- Complete settings menu accessible via GNOME Extensions app, Extension Manager, or `make prefs`.
- Toggle individual patterns, adjust animation speed, and tune pattern opacity.
- Frame rate counted in each display's own frames — every frame, every other frame, or about 60 or 30 a second — so motion stays even at any refresh rate.
- Pauses itself while fullscreen, maximized or tiled windows cover the desktop, and optionally on battery.

### 4. Performance
Every pattern is a GPU shader drawn at the monitor's full resolution; the
compositor's own thread only sets a few numbers per frame. On a GTX 1080 at
1920×1080, GPU time per frame:

| Pattern | ms | | Pattern | ms |
|---|---|---|---|---|
| Wave | 0.13 | | Starfield | 0.20 |
| Sparkles | 0.15 | | Embers | 0.45 |
| Nebula | 0.27 | | Bokeh | 0.25 |
| Aurora | 0.27 | | Constellation | 0.71 |

All eight together take 2.4ms of a 16.7ms (60Hz) or 4.2ms (240Hz) frame, and
about 4% of a CPU core at 60 FPS whichever patterns are on. `make bench` measures
your own GPU.

---

## Development & Usage

### Commands

```bash
# Link extension for development (symlinks src/ into ~/.local/share/gnome-shell/extensions)
make link

# Launch the Libadwaita Preferences menu
make prefs

# Reload the extension after code changes
make reload

# Compile every pattern's shader offline, or time each on the GPU
make check
make bench

# Visual testing in a throwaway nested GNOME Shell
make nested
make nested-headless
make preview
make nested-stop
```
