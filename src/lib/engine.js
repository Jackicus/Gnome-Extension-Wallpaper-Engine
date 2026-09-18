import * as Main from 'resource:///org/gnome/shell/ui/main.js';
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

        this._time = 0;
        this._dt = 0;
        this._lastFrameTime = 0;
        this._timerId = 0;
        this._clockFps = 0;
        this._surfaceW = 0;
        this._surfaceH = 0;

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

        // The base is a canvas of its own because it is still: it only changes
        // when the palette does, and it must not take the pattern opacity with
        // it. Keeping it here also keeps a full-screen gradient out of every
        // animated frame.
        this._base = new St.DrawingArea({
            width,
            height,
            reactive: false,
        });
        this._container.add_child(this._base);
        this._base.connect('repaint', (area) => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            try {
                if (this._state.mode === 'color')
                    paintPalette(cr, this._state.colorPalette, w, h);
            } finally {
                cr.$dispose();
            }
        });

        this._area = new St.DrawingArea({
            width,
            height,
            reactive: false,
        });
        this._area.set_pivot_point(0, 0);
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

        this._applyRenderScale();
        this._reconcile();
        this._updateBaseStyle();
        this._applyOpacity();
        this._startClock();
    }

    _updateBase() {
        if (!this._base) return;
        this._base.visible = this._state.mode === 'color';
        if (this._base.visible) this._base.queue_repaint();
    }

    /**
     * Sizes the canvas in real pixels.
     *
     * Everything a layer draws costs per pixel of this surface, and it is all
     * software Cairo on the compositor thread -- so drawing at a fraction of the
     * monitor and letting the GPU scale the texture back up is the cheapest
     * quality dial there is. Patterns are soft glows and gradients, which survive
     * it well; the sharp lines (wave crests, constellation links) are what goes
     * first.
     */
    _applyRenderScale() {
        const { width, height } = this.monitor;
        const scale = Math.max(0.25, Math.min(1.0, this._state.renderScale || 1.0));
        const sw = Math.max(1, Math.round(width * scale));
        const sh = Math.max(1, Math.round(height * scale));

        if (sw === this._surfaceW && sh === this._surfaceH) return;

        this._surfaceW = sw;
        this._surfaceH = sh;
        this._area.set_size(sw, sh);
        this._area.set_scale(width / sw, height / sh);

        // Layers precompute for one canvas size -- starfield bakes a band surface
        // of exactly it, constellation wraps its points against it -- so they have
        // to be told in the same pixels the draw handler will hand them.
        for (const layer of this._layers.values()) {
            layer.resize?.(sw, sh);
        }
    }

    _updateBaseStyle() {
        this._updateBase();

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

    _applyOpacity() {
        // Only the patterns fade: the gradient backdrop is a background, not a
        // pattern, and dimming it just showed the wallpaper through what is meant
        // to replace it.
        if (!this._area) return;
        const opacity = Math.max(0.1, Math.min(1.0, this._state.opacity));
        this._area.opacity = Math.round(opacity * 255);
    }

    _reconcile() {
        const next = new Map();
        for (const id of this._state.enabledEffects) {
            const effect = getEffect(id);
            if (!effect) continue;

            let layer = this._layers.get(id);
            if (!layer) {
                layer = effect.create();
                layer.resize?.(this._surfaceW, this._surfaceH);
            }
            next.set(id, layer);
        }
        this._layers = next;
    }

    updateState(newState) {
        const fpsChanged = newState.targetFps !== this._state.targetFps;
        this._state = newState;
        this._applyRenderScale();
        this._reconcile();
        this._updateBaseStyle();
        this._applyOpacity();

        // The clock is built around one interval, so a new frame rate needs a new
        // timer -- without this, changing it did nothing until the next reload.
        if (fpsChanged) {
            this._stopClock();
            this._startClock();
        }

        // A still canvas (no patterns) never repaints itself, so the base layer
        // has to be redrawn here or a palette change would not show.
        this._area?.queue_repaint();
    }

    _startClock() {
        if (this._timerId) return;

        this._clockFps = Math.max(15, this._state.targetFps || 30);
        const intervalMs = Math.round(1000 / this._clockFps);

        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            if (!this._container || !this._area) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }

            if (this._isIdle()) {
                // Resume from where the animation stopped rather than jumping
                // forward by however long the pause lasted.
                this._lastFrameTime = 0;
                return GLib.SOURCE_CONTINUE;
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

    /**
     * Whether this frame can be skipped. Every branch here is a frame's worth of
     * full-screen Cairo work that nobody would have seen, on the thread that also
     * drives the rest of the desktop.
     */
    _isIdle() {
        // Nothing animates, so the last paint still stands.
        if (this._layers.size === 0) return true;

        // Not on screen: another session mode (the lock screen above all), or an
        // actor that is not currently part of what gets painted.
        if (Main.sessionMode.isLocked) return true;
        if (!this._area.mapped) return true;

        // A fullscreen window covers this monitor's background entirely. Asking
        // the display rather than the focus window also catches a fullscreen
        // video on a second monitor while something else holds focus.
        if (this._state.pauseOnFullscreen &&
            global.display?.get_monitor_in_fullscreen(this.monitor.index))
            return true;

        if (this._state.pauseOnBattery && this._state.onBattery) return true;

        return false;
    }

    _stopClock() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _onDraw(cr, w, h) {
        // St hands over an already-cleared surface, and the base layer is painted
        // by a canvas of its own, so this handler is only ever the patterns.
        if (this._layers.size === 0) return;

        const scene = { w, h, t: this._time, dt: this._dt };

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

    destroy() {
        this._stopClock();
        this._layers.clear();
        if (this._container) {
            this._container.destroy();
            this._container = null;
        }
        this._area = null;
        this._base = null;
    }
}
