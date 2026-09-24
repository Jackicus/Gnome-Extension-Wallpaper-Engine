// The base -- the gradient or the picture under the patterns -- given to the
// shell's own background machinery instead of painted over it.
//
// Every wallpaper the shell puts on screen comes from one `BackgroundSource`:
// the desktop, the overview's workspace previews, their thumbnails, the strip
// that slides between workspaces, and whatever other extensions blur out of it
// (Blur My Shell's panel and overview backdrop are copies of that same
// background, which is why a canvas laid over the desktop leaves the old
// wallpaper showing in them). The source reads the wallpaper from a GSettings
// of `org.gnome.desktop.background`.
//
// So: hand it a GSettings of our own. Same schema -- so every key the shell
// reads is there, now and in whatever version comes next -- on a memory
// backend, so nothing is written to dconf and the user's real wallpaper is
// untouched and comes straight back when this is released. The base then
// appears everywhere a wallpaper appears, crossfaded by the shell itself when
// it changes, and all that is left for us to draw is the moving part.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GDesktopEnums from 'gi://GDesktopEnums';
import Clutter from 'gi://Clutter';
import cairo from 'cairo';
import * as Background from 'resource:///org/gnome/shell/ui/background.js';

import { PALETTES, paintPalette, paletteStops } from './palettes.js';

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';

// A palette is a gradient, so it has to be an image: Meta.Background paints a
// gradient of two colours, ours are four stops on a diagonal.
const FALLBACK_SIZE = [1920, 1080];

export class ShellBackground {
    constructor() {
        this._settings = Gio.Settings.new_with_backend(
            BACKGROUND_SCHEMA, Gio.memory_settings_backend_new());

        // Holding a manager of our own keeps the shared source alive whatever
        // else comes and goes, and hands it over without reaching into the
        // layout manager for it. Its actor is parented into an actor nobody
        // shows, so it is never painted.
        this._holder = null;
        this._source = null;
        this._shellSettings = null;
        this._applied = null;

        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'wallpaper-engine']);
    }

    /** Whether the shell is showing our base rather than the user's wallpaper. */
    get active() {
        return this._shellSettings !== null;
    }

    /**
     * Point the shell's wallpaper at whatever `background-mode` asks for, or
     * give it back in `desktop` mode.
     */
    update(state) {
        const base = this._describe(state);
        if (!base) {
            this.release();
            return;
        }

        // Every write to these settings, changed or not, has the shell rebuild
        // and crossfade every wallpaper it shows -- so a base that is already
        // up is left alone.
        const key = JSON.stringify(base);
        if (this.active && key === this._applied) return;
        this._applied = key;

        // Delayed so a change of mode and a change of picture reach the shell
        // as one, and cost one crossfade rather than two.
        this._settings.delay();
        this._settings.set_string('picture-uri', base.uri);
        this._settings.set_string('picture-uri-dark', base.uri);
        this._settings.set_enum('picture-options', base.style);
        this._settings.set_string('primary-color', base.color);
        this._settings.set_string('secondary-color', base.color);
        this._settings.set_enum('color-shading-type', GDesktopEnums.BackgroundShading.SOLID);
        this._settings.apply();

        this._attach();
    }

    /**
     * Hand the wallpaper back. Safe to call when it was never taken.
     */
    release() {
        const source = this._source;
        const shellSettings = this._shellSettings;

        this._source = null;
        this._shellSettings = null;
        this._applied = null;

        if (source && shellSettings) {
            source._settings = shellSettings;
            reloadBackgrounds(source);
        }

        if (this._holder) {
            this._holder.destroy();
            this._holder = null;
        }
    }

    destroy() {
        this.release();
        this._settings = null;
    }

    /**
     * What the shell should show under the patterns: a generated gradient, the
     * user's own picture, or nothing at all in `desktop` mode, where the point
     * is that their wallpaper shows through.
     */
    _describe(state) {
        if (state.mode === 'color') {
            const file = this._paletteFile(state.colorPalette);
            if (!file) return null;
            return {
                uri: file,
                // The image is generated at the size it will be shown at, so
                // stretching it is exact rather than a compromise.
                style: GDesktopEnums.BackgroundStyle.STRETCHED,
                color: paletteColor(state.colorPalette),
            };
        }

        // A picture that is not there would be a black desktop; letting the base
        // go shows the user's own wallpaper instead, as it did before one was
        // chosen.
        if (state.mode === 'image' && state.customImage &&
            GLib.file_test(state.customImage, GLib.FileTest.EXISTS)) {
            return {
                uri: Gio.File.new_for_path(state.customImage).get_uri(),
                style: GDesktopEnums.BackgroundStyle.ZOOM,
                color: '#000000',
            };
        }

        return null;
    }

    /**
     * The palette, rendered once to a PNG under the user's cache directory.
     *
     * The name carries a digest of the stops and the size, so an edited palette
     * is a different file rather than the same path with new bytes -- which the
     * shell's image cache would have to be told about. There is no pruning: the
     * shell watches the file it shows and reloads the wallpaper on any change to
     * it, even a touch, and eight palettes at a monitor size or two are a few
     * hundred kilobytes.
     */
    _paletteFile(name) {
        const key = PALETTES[name] ? name : 'Classic Blue';
        const [width, height] = baseSize();
        const digest = GLib.compute_checksum_for_string(
            GLib.ChecksumType.SHA256,
            JSON.stringify([PALETTES[key], width, height]), -1).slice(0, 12);
        const path = GLib.build_filenamev([this._cacheDir, `palette-${digest}.png`]);

        if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
            try {
                GLib.mkdir_with_parents(this._cacheDir, 0o755);
                const surface = new cairo.ImageSurface(cairo.Format.RGB24, width, height);
                const cr = new cairo.Context(surface);
                paintPalette(cr, key, width, height);
                cr.$dispose();
                surface.writeToPNG(path);
                surface.finish();
            } catch (e) {
                console.error(`[WallpaperEngine] Could not render palette ${key}: ${e}`);
                return null;
            }
        }
        return Gio.File.new_for_path(path).get_uri();
    }

    /**
     * Swap our settings in for the shell's on the one source every background
     * comes from, and tell the backgrounds already built from it to reload.
     */
    _attach() {
        if (this.active) return;

        const source = this._obtainSource();
        // Nothing here is public API. If the shell stops keeping the wallpaper
        // behind a settings object, the patterns still draw -- over the
        // user's own wallpaper, which is a missing feature, not a break.
        if (!source?._settings) {
            console.warn('[WallpaperEngine] No background source to take over; the base will not change');
            return;
        }

        this._shellSettings = source._settings;
        this._source = source;
        source._settings = this._settings;
        reloadBackgrounds(source);
    }

    _obtainSource() {
        if (!this._holder) {
            try {
                this._holder = new Background.BackgroundManager({
                    container: new Clutter.Actor(),
                    monitorIndex: 0,
                    controlPosition: false,
                });
            } catch (e) {
                console.error(`[WallpaperEngine] Could not reach the shell's backgrounds: ${e}`);
                return null;
            }
        }
        return this._holder._backgroundSource;
    }
}

/**
 * Drops the backgrounds a source has already built, through the same signal the
 * shell uses when the wallpaper setting changes -- so every manager holding one
 * rebuilds it and crossfades to the new one by itself.
 */
function reloadBackgrounds(source) {
    const backgrounds = source._backgrounds;
    if (!backgrounds) return;

    for (const key of Object.keys(backgrounds))
        backgrounds[key]?._emitChangedSignal?.();
}

// A solid stand-in for the gradient, shown for the moment before the image is
// loaded and if it cannot be.
function paletteColor(name) {
    const stops = paletteStops(name);
    const [, r, g, b] = stops[Math.floor(stops.length / 2)];
    return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// One image serves every monitor, so it is rendered for the largest of them.
function baseSize() {
    const monitors = global.display?.get_n_monitors?.() ?? 0;
    let width = 0;
    let height = 0;

    for (let i = 0; i < monitors; i++) {
        const rect = global.display.get_monitor_geometry(i);
        width = Math.max(width, rect.width);
        height = Math.max(height, rect.height);
    }

    if (width < 1 || height < 1) return FALLBACK_SIZE;
    return [width, height];
}
