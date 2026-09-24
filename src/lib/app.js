import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { MonitorRenderer, SceneClock } from './engine.js';
import { SystemState } from './system.js';
import { OverviewCanvas } from './overview.js';
import { ShellBackground } from './background.js';

// Keys that decide the base under the patterns, which the shell draws for us.
const BASE_KEYS = new Set(['background-mode', 'color-palette', 'custom-image', 'span-monitors']);

export class WallpaperEngineApp {
    constructor(extension) {
        this._settings = extension.getSettings();
        this._clock = new SceneClock();
        this._renderers = new Map(); // monitor index -> MonitorRenderer
    }

    enable() {
        this._interface = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._hasAccent = this._interface.settings_schema.has_key('accent-color');
        this._system = new SystemState(() => this._push(this._state()));

        // The base goes to the shell's own wallpaper, so it is already right
        // everywhere a wallpaper is shown: the overview, the workspace slide,
        // and whatever other extensions blur out of it.
        this._background = new ShellBackground();
        this._background.update(this._state());

        this._build();

        // The overview and the workspace slide draw wallpapers of their own,
        // so the patterns are lent to them as clones.
        this._overview = new OverviewCanvas(index => this._renderers.get(index)?.actor ?? null);
        this._overview.enable();

        Main.layoutManager.connectObject('monitors-changed', () => this._rebuild(), this);

        this._settings.connectObject('changed', (_s, key) => {
            if (key === 'span-monitors') {
                this._rebuild();
                return;
            }
            const state = this._state();
            if (BASE_KEYS.has(key)) this._background.update(state);
            this._push(state);
        }, this);

        if (this._hasAccent) {
            this._interface.connectObject('changed::accent-color',
                () => this._background.update(this._state()), this);
        }
    }

    // Gets through whatever enable() managed before it stopped, so the user's
    // wallpaper always comes back.
    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings.disconnectObject(this);
        this._interface?.disconnectObject(this);
        this._interface = null;

        this._overview?.destroy();
        this._overview = null;

        this._system?.destroy();
        this._system = null;

        // The user's wallpaper comes back before the patterns go, so the
        // desktop is never briefly bare.
        this._background?.destroy();
        this._background = null;

        this._teardown();
    }

    _state() {
        const s = this._settings;
        return {
            enabledEffects: s.get_strv('enabled-effects'),
            tuning: s.get_value('pattern-tuning').deepUnpack(),
            mode: s.get_string('background-mode'),
            colorPalette: s.get_string('color-palette'),
            customImage: s.get_string('custom-image'),
            // GNOME 47 on; before it, the blue it had always been.
            accent: this._hasAccent ? this._interface.get_string('accent-color') : 'blue',
            span: this._spanning(),
            targetFps: s.get_int('target-fps'),
            speed: s.get_double('speed'),
            opacity: s.get_double('opacity'),
            pauseWhenCovered: s.get_boolean('pause-when-covered'),
            pauseOnBattery: s.get_boolean('pause-on-battery'),
            onBattery: this._system.onBattery,
            powerSaver: this._system.powerSaver,
            animations: this._system.animations,
        };
    }

    _spanning() {
        return this._settings.get_boolean('span-monitors') && Main.layoutManager.monitors.length > 1;
    }

    /**
     * What each monitor draws. On its own, a monitor is its own canvas; spanned,
     * every monitor draws its part of the box around them all, sized by the
     * primary monitor and with one seed, so that the parts make one picture.
     */
    _views() {
        const monitors = Main.layoutManager.monitors;
        if (!this._spanning()) {
            return monitors.map(m => ({
                canvas: { x: m.x, y: m.y, width: m.width, height: m.height },
                unit: m.height / 1080,
                seed: m.index * 17.31,
            }));
        }

        const x = Math.min(...monitors.map(m => m.x));
        const y = Math.min(...monitors.map(m => m.y));
        const canvas = {
            x,
            y,
            width: Math.max(...monitors.map(m => m.x + m.width)) - x,
            height: Math.max(...monitors.map(m => m.y + m.height)) - y,
        };
        const unit = Main.layoutManager.primaryMonitor.height / 1080;
        return monitors.map(() => ({ canvas, unit, seed: 0 }));
    }

    _build() {
        this._teardown();

        const state = this._state();
        this._tuneClock(state);

        // Over the wallpaper, under the windows. Private, and so checked: without
        // it there is nowhere to draw that would not cover the windows.
        const group = Main.layoutManager._backgroundGroup;
        if (!group) {
            console.warn('[WallpaperEngine] No background group to draw in');
            return;
        }

        const views = this._views();
        for (const monitor of Main.layoutManager.monitors) {
            const renderer = new MonitorRenderer(monitor, views[monitor.index], this._clock, state);
            this._renderers.set(monitor.index, renderer);
            group.add_child(renderer.actor);
        }
    }

    _rebuild() {
        this._background.update(this._state());
        this._build();
        this._overview.invalidate();
    }

    _push(state) {
        this._tuneClock(state);
        for (const renderer of this._renderers.values())
            renderer.setState(state);
    }

    _tuneClock(state) {
        this._clock.speed = state.speed;
        this._clock.rates.clear();
        for (const [id, tuning] of Object.entries(state.tuning))
            this._clock.rates.set(id, tuning.speed ?? 1);
    }

    _teardown() {
        for (const renderer of this._renderers.values())
            renderer.destroy();
        this._renderers.clear();
    }
}
