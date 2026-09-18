import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class WallpaperEngineExtension extends Extension {
    async enable() {
        this._runDir = null;
        const enabling = this._enabling = {};

        try {
            const runDir = this._stageLib();
            const module = await import(`file://${runDir}/app.js`);
            if (this._enabling !== enabling)
                return;

            this._app = new module.WallpaperEngineApp(this);
            this._app.enable();
            console.log(`[WallpaperEngine] Enabled from ${runDir}`);
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
        if (this._runDir) {
            this._removeTree(Gio.File.new_for_path(this._runDir));
            this._runDir = null;
        }
    }

    _stageLib() {
        const base = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'wallpaper-engine']);
        this._removeTree(Gio.File.new_for_path(base));

        const runDir = GLib.build_filenamev([base, `lib-${Date.now()}`]);
        GLib.mkdir_with_parents(runDir, 0o700);

        const srcLib = this.dir.get_child('lib');
        this._copyTree(srcLib, Gio.File.new_for_path(runDir));

        this._runDir = runDir;
        return runDir;
    }

    _copyTree(src, dest) {
        if (!src.query_exists(null)) return;

        const it = src.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info;
        while ((info = it.next_file(null))) {
            const name = info.get_name();
            const childSrc = src.get_child(name);
            const childDest = dest.get_child(name);

            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                childDest.make_directory_with_parents(null);
                this._copyTree(childSrc, childDest);
            } else if (info.get_file_type() === Gio.FileType.REGULAR && name.endsWith('.js')) {
                childSrc.copy(childDest, Gio.FileCopyFlags.OVERWRITE, null, null);
            }
        }
        it.close(null);
    }

    _removeTree(file) {
        if (!file.query_exists(null)) return;
        try {
            const it = file.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                null
            );
            let info;
            while ((info = it.next_file(null))) {
                const child = file.get_child(info.get_name());
                if (info.get_file_type() === Gio.FileType.DIRECTORY)
                    this._removeTree(child);
                else
                    child.delete(null);
            }
            it.close(null);
            file.delete(null);
        } catch (e) {
            console.warn(`[WallpaperEngine] Could not clean ${file.get_path()}: ${e.message}`);
        }
    }
}
