import St from 'gi://St';
import GLib from 'gi://GLib';
import cairo from 'cairo';

import { getEffect } from './catalog.js';
import { paintPalette } from './palettes.js';

/**
 * Renderer for a single monitor using St.DrawingArea for native Cairo rendering.
 */
export class MonitorRenderer {
    constructor(monitor, settingsState) {
        this.monitor = monitor;
        this._state = settingsState;

        this._layers = new Map(); // id -> EffectLayer instance
        this._activeIds = [];

        this._time = 0;
        this._dt = 0;
        this._lastFrameTime = 0;
        this._timerId = 0;

        this._build();
    }

    get actor() {
        return this._container;
    }

    _build() {
        const { width, height, x, y } = this.monitor;

        this._container = new St.Widget({
            name: `WallpaperEngine-Monitor-${this.monitor.index}`,
            x,
            y,
            width,
            height,
            reactive: false,
        });

        this._area = new St.DrawingArea({
            width,
            height,
            reactive: false,
        });
        this._container.add_child(this._area);

        this._area.connect('repaint', (area) => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            try {
                this._onDraw(cr, w, h);
            } finally {
                cr.$dispose();
            }
        });

        this._reconcile();
        this._updateBaseStyle();
        this._startClock();
    }

    _updateBaseStyle() {
        if (!this._container) return;

        if (this._state.mode === 'image' && this._state.customImage) {
            const path = this._state.customImage;
            this._container.set_style(
                `background-image: url("file://${encodeURI(path)}"); background-size: cover; background-position: center;`
            );
        } else {
            this._container.set_style(null);
        }
    }

    _reconcile() {
        const next = new Map();
        for (const id of this._state.enabledEffects) {
            const effect = getEffect(id);
            if (!effect) continue;

            let layer = this._layers.get(id);
            if (!layer) {
                layer = effect.create();
                layer.resize?.(this.monitor.width, this.monitor.height);
            }
            next.set(id, layer);
        }
        this._layers = next;
        this._activeIds = [...next.keys()];
    }

    updateState(newState) {
        this._state = newState;
        this._reconcile();
        this._updateBaseStyle();

        if (this._area) {
            this._area.opacity = Math.round(Math.max(0.1, Math.min(1.0, this._state.opacity)) * 255);
            this._area.queue_repaint();
        }
    }

    resize(monitor) {
        this.monitor = monitor;
        const { width, height, x, y } = monitor;
        this._container.set_position(x, y);
        this._container.set_size(width, height);
        this._area.set_size(width, height);

        for (const layer of this._layers.values()) {
            layer.resize?.(width, height);
        }
        this._area.queue_repaint();
    }

    _startClock() {
        if (this._timerId) return;

        const fps = Math.max(15, this._state.targetFps || 30);
        const intervalMs = Math.round(1000 / fps);

        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            if (!this._container || !this._area) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }

            // Pause check: if desktop mode and no active layers, sleep
            if (this._state.mode === 'desktop' && this._layers.size === 0) {
                return GLib.SOURCE_CONTINUE;
            }

            // Pause check: fullscreen window on this monitor
            if (this._state.pauseOnFullscreen) {
                const focusWindow = global.display?.focus_window;
                if (focusWindow && focusWindow.is_fullscreen() && focusWindow.get_monitor() === this.monitor.index) {
                    return GLib.SOURCE_CONTINUE;
                }
            }

            const now = GLib.get_monotonic_time() / 1000000;
            if (this._lastFrameTime === 0) {
                this._lastFrameTime = now;
                return GLib.SOURCE_CONTINUE;
            }

            const delta = now - this._lastFrameTime;
            this._lastFrameTime = now;

            const clampedDelta = Math.min(delta, 0.05);
            this._dt = clampedDelta;
            this._time += clampedDelta * (this._state.speed || 1.0);

            this._area.queue_repaint();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopClock() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _onDraw(cr, w, h) {
        cr.save();

        // 1. Base Layer
        if (this._state.mode === 'color') {
            paintPalette(cr, this._state.colorPalette, w, h);
        } else {
            // Desktop overlay or image background: clear canvas to transparent
            cr.setOperator(cairo.Operator.CLEAR);
            cr.paint();
        }
        cr.restore();

        // 2. Animated Pattern Layers
        if (this._layers.size > 0) {
            const scene = {
                w,
                h,
                t: this._time,
                dt: this._dt,
            };

            for (const layer of this._layers.values()) {
                cr.save();
                try {
                    layer.draw(cr, scene);
                } catch (e) {
                    console.error(`[WallpaperEngine] Layer draw error: ${e}`);
                }
                cr.restore();
            }
        }
    }

    destroy() {
        this._stopClock();
        this._layers.clear();
        this._activeIds = [];
        if (this._container) {
            this._container.destroy();
            this._container = null;
        }
        this._area = null;
    }
}
