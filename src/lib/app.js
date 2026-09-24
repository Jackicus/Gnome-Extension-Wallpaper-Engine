import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MonitorRenderer, SceneClock } from './engine.js';
import { PowerMonitor } from './power.js';
import { OverviewCanvas } from './overview.js';
import { ShellBackground } from './background.js';

// Keys that decide the base under the patterns, which the shell draws for us.
const BASE_KEYS = new Set(['background-mode', 'color-palette', 'custom-image']);

export class WallpaperEngineApp {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._clock = new SceneClock();
        this._renderers = new Map(); // monitor index -> MonitorRenderer
        this._power = null;
    }

    enable() {
        // The base goes to the shell's own wallpaper, so it is already right
        // everywhere a wallpaper is shown: the overview, the workspace slide,
        // and whatever other extensions blur out of it.
        this._background = new ShellBackground();
        this._background.update(this._state());

        this._syncPower();
        this._build();

        // The overview and the workspace slide draw wallpapers of their own,
        // so the patterns are lent to them as clones.
        this._overview = new OverviewCanvas(index => this._renderers.get(index)?.actor ?? null);
        this._overview.enable();

        Main.layoutManager.connectObject('monitors-changed', () => {
            this._background.update(this._state());
            this._build();
            this._overview.invalidate();
        }, this);

        this._settings.connectObject('changed', (_s, key) => {
            if (key === 'pause-on-battery') this._syncPower();
            const state = this._state();
            if (BASE_KEYS.has(key)) this._background.update(state);
            this._push(state);
        }, this);
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);

        this._overview.destroy();
        this._overview = null;

        this._power?.destroy();
        this._power = null;

        // The user's wallpaper comes back before the patterns go, so the
        // desktop is never briefly bare.
        this._background.destroy();
        this._background = null;

        this._teardown();
    }

    _state() {
        const s = this._settings;
        return {
            enabledEffects: s.get_strv('enabled-effects'),
            mode: s.get_string('background-mode'),
            colorPalette: s.get_string('color-palette'),
            customImage: s.get_string('custom-image'),
            targetFps: s.get_int('target-fps'),
            speed: s.get_double('speed'),
            opacity: s.get_double('opacity'),
            pauseWhenCovered: s.get_boolean('pause-when-covered'),
            pauseOnBattery: s.get_boolean('pause-on-battery'),
            onBattery: this._power?.onBattery ?? false,
        };
    }

    // UPower is only worth watching while something acts on it.
    _syncPower() {
        const wanted = this._settings.get_boolean('pause-on-battery');
        if (wanted && !this._power) {
            this._power = new PowerMonitor(() => this._push(this._state()));
        } else if (!wanted && this._power) {
            this._power.destroy();
            this._power = null;
        }
    }

    _build() {
        this._teardown();

        const state = this._state();
        this._clock.speed = state.speed;

        for (const monitor of Main.layoutManager.monitors) {
            const renderer = new MonitorRenderer(monitor, this._clock, state);
            this._renderers.set(monitor.index, renderer);
            // Over the wallpaper, under the windows.
            Main.layoutManager._backgroundGroup.add_child(renderer.actor);
        }

        console.log(`[WallpaperEngine] Active on ${this._renderers.size} monitor(s) with ` +
            `effects: ${state.enabledEffects.join(', ') || 'none'}`);
    }

    _push(state) {
        this._clock.speed = state.speed;
        for (const renderer of this._renderers.values())
            renderer.setState(state);
    }

    _teardown() {
        for (const renderer of this._renderers.values())
            renderer.destroy();
        this._renderers.clear();
    }
}
