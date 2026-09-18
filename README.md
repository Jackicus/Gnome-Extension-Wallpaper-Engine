# GNOME Wallpaper Engine

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
- **Bokeh**: Large out-of-focus rising lights with sharp rim lighting.
- **Constellation**: Drifting nodes that dynamically weave and unweave a proximity mesh.

### 2. Flexible Base Layers
- **Desktop Wallpaper (Overlay)**: Renders patterns with transparency directly over your existing GNOME wallpaper.
- **Color Gradient**: Renders patterns over 8 handcrafted palettes (*Classic Blue*, *Dark*, *Red*, *Green*, *Gold*, *Aurora*, *Dusk*, *Nebula*).
- **Custom Picture**: Choose your own background image via a file picker.

### 3. Preferences Dialog (Libadwaita)
- Complete settings menu accessible via GNOME Extensions app, Extension Manager, or `make prefs`.
- Toggle individual patterns, adjust animation speed multiplier, and tune pattern opacity.
- Configure target frame rate (30 FPS default for battery efficiency, or 60 FPS for maximum smoothness).
- Automatic power saving: optionally pause animation when fullscreen windows are active or when running on battery.

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

# Visual testing in a throwaway nested GNOME Shell
make nested
make nested-headless
make preview
make nested-stop
```
