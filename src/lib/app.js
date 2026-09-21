import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { MonitorRenderer } from './engine.js';
import { parseEffectIds } from './catalog.js';
import { PowerMonitor } from './power.js';
import { OverviewCanvas } from './overview.js';
import { ShellBackground } from './background.js';

const DEFAULTS = {
    enabledEffects: ['wave', 'sparkles'],
    mode: 'desktop',
    colorPalette: 'Classic Blue',
    customImage: '',
    targetFps: 0,
    renderScale: 0.75,
    cpuBudget: 0.5,
    speed: 1.0,
    opacity: 1.0,
    pauseOnFullscreen: true,
    pauseOnBattery: false,
    nativeBase: false,
    monitorCount: 1,
};

export class WallpaperEngineApp {
    constructor(extension) {
        this._extension = extension;
        this._settings = null;
        this._rootContainer = null;
        this._power = null;
        this._overview = null;
        this._background = null;
        this._renderers = new Map(); // monitorIndex -> MonitorRenderer

        try {
            this._settings = extension.getSettings();
        } catch (e) {
            console.warn(`[WallpaperEngine] No settings available, using defaults: ${e}`);
        }
    }

    enable() {
        // The base goes to the shell's own wallpaper before anything is built,
        // so the renderers know whether they still have one to paint.
        this._background = new ShellBackground();
        this._background.update(this._getState());

        this._build();

        // The overview and the workspace slide draw their own wallpaper, so the
        // canvas has to be lent to them as a clone or the desktop goes bare the
        // moment either one starts.
        this._overview = new OverviewCanvas(index => this._renderers.get(index)?.actor ?? null);
        this._overview.enable();

        Main.layoutManager.connectObject(
            'monitors-changed', () => this._onMonitorsChanged(),
            this
        );

        // Every key feeds the same state object, so one handler covers them all.
        this._settings?.connectObject('changed', (_s, key) => {
            if (key === 'pause-on-battery') this._syncPowerMonitor();
            this._pushState();
        }, this);

        this._syncPowerMonitor();
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings?.disconnectObject(this);

        this._overview?.destroy();
        this._overview = null;

        this._power?.destroy();
        this._power = null;

        // Gives the user's wallpaper back before the canvas over it goes away,
        // so the desktop is never briefly bare.
        this._background?.destroy();
        this._background = null;

        this._teardown();
    }

    /**
     * UPower is only worth watching while something acts on it.
     */
    _syncPowerMonitor() {
        const wanted = this._settings
            ? this._settings.get_boolean('pause-on-battery')
            : DEFAULTS.pauseOnBattery;

        if (wanted && !this._power) {
            this._power = new PowerMonitor(() => this._pushState());
        } else if (!wanted && this._power) {
            this._power.destroy();
            this._power = null;
        }
    }

    _getState() {
        const settings = this._settings;
        // Each monitor gets a renderer of its own and draws the whole stack, so
        // the cpu-budget -- which is for the wallpaper, not for one head -- has
        // to be split between them before a renderer can pace against it.
        const monitorCount = Math.max(1, Main.layoutManager.monitors?.length ?? 1);

        if (!settings)
            return { ...DEFAULTS, onBattery: false, monitorCount };

        return {
            monitorCount,
            enabledEffects: parseEffectIds(settings.get_strv('enabled-effects')),
            mode: settings.get_string('background-mode') || DEFAULTS.mode,
            colorPalette: settings.get_string('color-palette') || DEFAULTS.colorPalette,
            customImage: settings.get_string('custom-image') || DEFAULTS.customImage,
            // Not `||`: zero is "follow the display", and so is every negative.
            targetFps: settings.get_int('target-fps'),
            renderScale: settings.get_double('render-scale') || DEFAULTS.renderScale,
            // Zero is a real setting here too: no limit at all.
            cpuBudget: settings.get_double('cpu-budget'),
            speed: settings.get_double('speed') || DEFAULTS.speed,
            opacity: settings.get_double('opacity') || DEFAULTS.opacity,
            pauseOnFullscreen: settings.get_boolean('pause-on-fullscreen'),
            pauseOnBattery: settings.get_boolean('pause-on-battery'),
            onBattery: this._power?.onBattery ?? false,
            nativeBase: this._background?.active ?? false,
        };
    }

    _build() {
        this._teardown();

        this._rootContainer = new St.Widget({
            name: 'WallpaperEngineRoot',
            layout_manager: new Clutter.BinLayout(),
            reactive: false,
            x: 0,
            y: 0,
            width: global.stage.width,
            height: global.stage.height,
        });

        const state = this._getState();
        const monitors = Main.layoutManager.monitors;

        for (const monitor of monitors) {
            const renderer = new MonitorRenderer(monitor, state);
            this._renderers.set(monitor.index, renderer);
            this._rootContainer.add_child(renderer.actor);
        }

        // Attach behind windows, over desktop background
        const bgGroup = Main.layoutManager._backgroundGroup;
        if (bgGroup) {
            bgGroup.add_child(this._rootContainer);
        } else {
            global.window_group.insert_child_at_index(this._rootContainer, 0);
        }

        console.log(`[WallpaperEngine] Active on ${monitors.length} monitor(s) with effects: ${state.enabledEffects.join(', ')}`);
    }

    _onMonitorsChanged() {
        console.log('[WallpaperEngine] Monitors changed, updating layout...');
        // A palette is rendered at the size of the largest monitor.
        this._background?.update(this._getState());
        this._build();
        // Any clone handed out points at a renderer that no longer exists.
        this._overview?.invalidate();
    }

    _pushState() {
        // The mode or the picture may have changed, and whether the shell is
        // carrying the base decides what the renderers draw.
        this._background?.update(this._getState());

        const state = this._getState();
        for (const renderer of this._renderers.values()) {
            renderer.updateState(state);
        }
    }

    _teardown() {
        for (const renderer of this._renderers.values()) {
            renderer.destroy();
        }
        this._renderers.clear();

        if (this._rootContainer) {
            this._rootContainer.destroy();
            this._rootContainer = null;
        }
    }
}
