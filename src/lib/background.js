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

import { PALETTES, paintPalette } from './palettes.js';

const BACKGROUND_SCHEMA = 'org.gnome.desktop.background';

// A palette is a gradient, so it has to be an image: Meta.Background paints a
// gradient of two colours, ours are four stops on a diagonal.
const FALLBACK_SIZE = [1920, 1080];

// How long a rendered palette stays in the cache after the last time it was used.
const PALETTE_CACHE_DAYS = 7;

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

        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'wallpaper-engine']);
    }

    /**
     * Whether the base is coming from the shell's background right now. False
     * means nothing was taken over -- the renderers have to paint their own.
     */
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
     * shell's image cache would have to be told about.
     */
    _paletteFile(name) {
        const key = PALETTES[name] ? name : 'Classic Blue';
        const [width, height] = baseSize();
        const digest = GLib.compute_checksum_for_string(
            GLib.ChecksumType.SHA256,
            JSON.stringify([key, PALETTES[key].stops, width, height]), -1).slice(0, 12);
        const path = GLib.build_filenamev([this._cacheDir, `palette-${digest}.png`]);

        if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
            touch(path);
            return Gio.File.new_for_path(path).get_uri();
        }

        try {
            GLib.mkdir_with_parents(this._cacheDir, 0o755);

            const surface = new cairo.ImageSurface(cairo.Format.RGB24, width, height);
            const cr = new cairo.Context(surface);
            paintPalette(cr, key, width, height);
            cr.$dispose();
            surface.flush();
            surface.writeToPNG(path);
            surface.finish();
        } catch (e) {
            console.error(`[WallpaperEngine] Could not render palette ${key}: ${e}`);
            return null;
        }

        this._prune(path);
        return Gio.File.new_for_path(path).get_uri();
    }

    /**
     * Every palette ever rendered would otherwise stay in the cache directory.
     *
     * Only the long-untouched ones go: a second session (a nested shell, a
     * second login) may be showing a palette this one has never asked for, and
     * deleting the file out from under it would leave it with a wallpaper that
     * no longer exists.
     */
    _prune(keep) {
        const cutoff = GLib.DateTime.new_now_local().add_days(-PALETTE_CACHE_DAYS);

        try {
            const dir = Gio.File.new_for_path(this._cacheDir);
            const enumerator = dir.enumerate_children(
                `${Gio.FILE_ATTRIBUTE_STANDARD_NAME},${Gio.FILE_ATTRIBUTE_TIME_MODIFIED}`,
                Gio.FileQueryInfoFlags.NONE, null);

            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                const name = info.get_name();
                if (!name.startsWith('palette-') || !name.endsWith('.png')) continue;

                const path = GLib.build_filenamev([this._cacheDir, name]);
                if (path === keep) continue;
                if (info.get_modification_date_time()?.compare(cutoff) > 0) continue;

                GLib.unlink(path);
            }
            enumerator.close(null);
        } catch (e) {
            console.warn(`[WallpaperEngine] Could not prune palette cache: ${e}`);
        }
    }

    /**
     * Swap our settings in for the shell's on the one source every background
     * comes from, and tell the backgrounds already built from it to reload.
     */
    _attach() {
        if (this.active) return;

        const source = this._obtainSource();
        // Nothing here is public API. If the shell stops keeping the wallpaper
        // behind a settings object, the renderers still have their own base
        // canvas to fall back on -- so this is a missing feature, not a break.
        if (!source?._settings) {
            console.warn('[WallpaperEngine] No background source to take over; painting the base instead');
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
    const palette = PALETTES[name] || PALETTES['Classic Blue'];
    const [, r, g, b] = palette.stops[Math.floor(palette.stops.length / 2)];
    const hex = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// Marks a cached palette as still in use, so pruning leaves it alone.
function touch(path) {
    try {
        Gio.File.new_for_path(path).set_attribute_uint64(
            Gio.FILE_ATTRIBUTE_TIME_MODIFIED,
            GLib.DateTime.new_now_local().to_unix(),
            Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        // A cache file that cannot be touched is one that will be pruned early
        // and rendered again; not worth a word in the log.
    }
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
