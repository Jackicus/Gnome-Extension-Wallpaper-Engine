import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';

import { MonitorRenderer } from './engine.js';
import { parseEffectIds } from './catalog.js';

export class WallpaperEngineApp {
    constructor(extension) {
        this._extension = extension;
        this._settings = null;
        this._rootContainer = null;
        this._renderers = new Map(); // monitorIndex -> MonitorRenderer

        try {
            this._settings = extension.getSettings();
        } catch (e) {
            console.warn(`[WallpaperEngine] No settings available, using defaults: ${e}`);
        }
    }

    enable() {
        this._build();

        Main.layoutManager.connectObject(
            'monitors-changed', () => this._onMonitorsChanged(),
            this
        );

        if (this._settings) {
            const keys = [
                'enabled-effects',
                'background-mode',
                'color-palette',
                'custom-image',
                'target-fps',
                'speed',
                'opacity',
                'pause-on-fullscreen',
                'pause-on-battery',
            ];
            for (const key of keys) {
                this._settings.connectObject(`changed::${key}`, () => this._onSettingsChanged(), this);
            }
        }
    }

    disable() {
        Main.layoutManager.disconnectObject(this);
        this._settings?.disconnectObject(this);

        this._teardown();
    }

    _getState() {
        if (!this._settings) {
            return {
                enabledEffects: ['wave', 'sparkles'],
                mode: 'desktop',
                colorPalette: 'Classic Blue',
                customImage: '',
                targetFps: 30,
                speed: 1.0,
                opacity: 1.0,
                pauseOnFullscreen: true,
                pauseOnBattery: false,
            };
        }

        return {
            enabledEffects: parseEffectIds(this._settings.get_strv('enabled-effects')),
            mode: this._settings.get_string('background-mode') || 'desktop',
            colorPalette: this._settings.get_string('color-palette') || 'Classic Blue',
            customImage: this._settings.get_string('custom-image') || '',
            targetFps: this._settings.get_int('target-fps') || 30,
            speed: this._settings.get_double('speed') || 1.0,
            opacity: this._settings.get_double('opacity') || 1.0,
            pauseOnFullscreen: this._settings.get_boolean('pause-on-fullscreen'),
            pauseOnBattery: this._settings.get_boolean('pause-on-battery'),
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
        this._build();
    }

    _onSettingsChanged() {
        const state = this._getState();
        console.log(`[WallpaperEngine] Settings changed. Mode: ${state.mode}, Effects: ${state.enabledEffects.join(', ')}`);
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
