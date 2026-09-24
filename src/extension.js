import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { WallpaperEngineApp } from './lib/app.js';

export default class WallpaperEngineExtension extends Extension {
    enable() {
        this._app = new WallpaperEngineApp(this);
        this._app.enable();
    }

    disable() {
        this._app.disable();
        this._app = null;
    }
}
