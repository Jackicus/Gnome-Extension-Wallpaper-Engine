import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class WallpaperEngineExtension extends Extension {
    async enable() {
        const enabling = this._enabling = {};

        try {
            const lib = this._libDir();
            const module = await import(lib.get_child('app.js').get_uri());
            if (this._enabling !== enabling)
                return;

            this._app = new module.WallpaperEngineApp(this);
            this._app.enable();
            console.log(`[WallpaperEngine] Enabled from ${lib.get_path()}`);
        } catch (e) {
            console.error('[WallpaperEngine] Failed to load lib/app.js:', e);
        }
    }

    disable() {
        this._enabling = null;
        if (this._app) {
            try {
                this._app.disable();
            } catch (e) {
                console.error('[WallpaperEngine] Error during disable:', e);
            }
            this._app = null;
        }
    }

    /**
     * Where to import lib/ from.
     *
     * The shell keeps a module for its whole life, keyed by URL. For an
     * install that is right: the patterns' shaders are compiled once and reused
     * across every lock and unlock. For a development link (`make link`) it
     * would mean an edit is never picked up without logging out -- so there,
     * and only there, lib/ is copied somewhere new on every enable.
     */
    _libDir() {
        const lib = this.dir.get_child('lib');
        const info = this.dir.query_info('standard::is-symlink', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (!info.get_is_symlink())
            return lib;

        const base = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'wallpaper-engine']);
        removeTree(Gio.File.new_for_path(base));
        const staged = Gio.File.new_for_path(GLib.build_filenamev([base, `lib-${Date.now()}`]));
        staged.make_directory_with_parents(null);
        copyTree(lib, staged);
        return staged;
    }
}

function copyTree(src, dest) {
    const it = src.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    let info;
    while ((info = it.next_file(null))) {
        const name = info.get_name();
        if (info.get_file_type() === Gio.FileType.DIRECTORY) {
            dest.get_child(name).make_directory(null);
            copyTree(src.get_child(name), dest.get_child(name));
        } else if (name.endsWith('.js')) {
            src.get_child(name).copy(dest.get_child(name), Gio.FileCopyFlags.NONE, null, null);
        }
    }
    it.close(null);
}

function removeTree(file) {
    try {
        const it = file.enumerate_children('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        let info;
        while ((info = it.next_file(null))) {
            const child = file.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY) removeTree(child);
            else child.delete(null);
        }
        it.close(null);
        file.delete(null);
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.warn(`[WallpaperEngine] Could not clean ${file.get_path()}: ${e.message}`);
    }
}
