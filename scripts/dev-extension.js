// The development entry point, installed by `make link` in place of
// src/extension.js. See _libDir() for why it exists; nothing here ships.

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
     * A copy of lib/ at a new path, to import from.
     *
     * The shell keeps a module for its whole life, keyed by URL, so an edit
     * under lib/ would never be picked up without logging out. `make link`
     * installs this file as the extension's entry point in place of
     * src/extension.js -- which imports lib/ once, as an install should -- and
     * it copies lib/ somewhere new on every enable instead, so `make reload`
     * runs whatever is on disk.
     */
    _libDir() {
        const base = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'wallpaper-engine']);
        removeTree(Gio.File.new_for_path(base));
        const staged = Gio.File.new_for_path(GLib.build_filenamev([base, `lib-${Date.now()}`]));
        staged.make_directory_with_parents(null);
        copyTree(this.dir.get_child('lib'), staged);
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
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            console.warn(`[WallpaperEngine] Could not clean ${file.get_path()}: ${e.message}`);
    }
}
