import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { EFFECTS } from './catalog.js';
import { EPOCH_S, effectClass } from './shader.js';

// Longer than this between two paints is a pause (a covered desktop, a
// fullscreen window, a blanked screen), and the animation picks up where it
// stopped instead of leaping ahead by however long that was.
const MAX_STEP_S = 0.1;

// Paints closer together than this are one frame: every pattern, every monitor
// and every copy in the overview shows the same instant. Well under the gap
// between frames of the fastest panel.
const SAME_FRAME_US = 1000;

// Windows covering all but this share of a monitor's work area hide its desktop,
// gaps between tiled windows included.
const COVERED = 0.95;

/**
 * The animation's own time: seconds of motion so far, scaled by the speed
 * setting, and shared by every monitor so they stay in step.
 */
export class SceneClock {
    constructor() {
        this.speed = 1;
        this._t = 0;
        this._lastUs = 0;
    }

    /** Advances to now and returns the scene time. Called from paint. */
    now() {
        const us = GLib.get_monotonic_time();
        const dt = (us - this._lastUs) / 1e6;
        if (this._lastUs && dt < SAME_FRAME_US / 1e6) return this._t;
        if (this._lastUs && dt <= MAX_STEP_S) this._t += dt * this.speed;
        this._lastUs = us;
        return this._t;
    }
}

/**
 * One monitor's patterns: an actor the size of the monitor, holding one child
 * per enabled pattern, each painted entirely by that pattern's shader.
 *
 * Pacing hangs off the paint itself. Every paint books the next one for
 * `divisor` refreshes later -- half a refresh early, so it lands on that frame
 * and not the one after -- which keeps the frames in step with the display.
 * A paint that comes while the patterns should rest books nothing, and neither
 * does one that never comes (Clutter skips an actor nothing can see), so they
 * cost nothing at all until the compositor next paints the desktop of its own
 * accord: a window moving off it, the overview opening, a setting changing.
 */
export class MonitorRenderer {
    constructor(monitor, clock, state) {
        this.monitor = monitor;
        this._clock = clock;
        this._timerId = 0;
        this._layers = new Map(); // pattern id -> { actor, effect, state, t }

        this.actor = new Clutter.Actor({
            name: `WallpaperEngine-Monitor-${monitor.index}`,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            reactive: false,
        });

        this.setState(state);
    }

    setState(state) {
        this._state = state;

        const wanted = EFFECTS.filter(e => state.enabledEffects.includes(e.id));
        for (const [id, layer] of this._layers) {
            if (wanted.some(e => e.id === id)) continue;
            layer.actor.destroy();
            this._layers.delete(id);
        }
        // Drawn in catalog order, whatever order they were switched on in.
        wanted.forEach((effect, index) => {
            if (!this._layers.has(effect.id)) this._layers.set(effect.id, this._createLayer(effect));
            this.actor.set_child_at_index(this._layers.get(effect.id).actor, index);
        });

        this.actor.opacity = Math.round(Math.max(0.1, Math.min(1, state.opacity)) * 255);
        this.kick();
    }

    _createLayer(effect) {
        const { width, height, index } = this.monitor;
        const Effect = effectClass(effect);
        const layer = {
            actor: new Clutter.Actor({ width, height, reactive: false }),
            effect: new Effect(),
            state: effect.State ? new effect.State(width, height, index) : null,
            t: -1,
        };
        layer.effect.setUniform('u_res', 2, [width, height]);
        // Two monitors side by side should not show the same sparkles.
        layer.effect.setUniform('u_seed', 1, [index * 17.31]);
        layer.effect.onPaint = () => this._onPaint(layer);
        layer.actor.add_effect(layer.effect);
        this.actor.add_child(layer.actor);
        return layer;
    }

    /** Starts the frames again, if there is anything to show. */
    kick() {
        if (this._timerId || this._paused()) return;
        for (const layer of this._layers.values()) layer.effect.queue_repaint();
    }

    // Whether to stop asking for frames. The overview and the workspace slide
    // show the patterns through clones, over whatever windows the desktop has,
    // so a paint through a clone is never covered.
    _paused(throughClone = false) {
        const state = this._state;
        if (this._layers.size === 0) return true;
        if (state.pauseOnBattery && state.onBattery) return true;
        return state.pauseWhenCovered && !throughClone && desktopCovered(this.monitor.index);
    }

    _onPaint(layer) {
        const t = this._clock.now();
        if (t !== layer.t) {
            layer.t = t;
            const epoch = Math.floor(t / EPOCH_S) * EPOCH_S;
            layer.effect.setUniform('u_epoch', 1, [epoch]);
            layer.effect.setUniform('u_time', 1, [t - epoch]);
            for (const [name, components, values] of layer.state?.uniforms(t) ?? [])
                layer.effect.setUniform(name, components, values);
        }

        if (this._timerId || this._paused(layer.actor.is_in_clone_paint())) return;
        const periodMs = 1000 / this._refreshRate();
        const delay = Math.max(1, Math.round((this._divisor(1000 / periodMs) - 0.5) * periodMs));
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timerId = 0;
            for (const l of this._layers.values()) l.effect.queue_repaint();
            return GLib.SOURCE_REMOVE;
        });
    }

    // `target-fps`: 0 is every frame the display shows, -N every Nth, and a
    // positive number the whole divisor nearest that many frames a second.
    _divisor(hz) {
        const target = this._state.targetFps;
        if (target > 0) return Math.max(1, Math.round(hz / target));
        return Math.max(1, Math.min(8, -target));
    }

    // The rate of the view this monitor is painted on, which is what tells a
    // 240Hz head from the 60Hz one beside it.
    _refreshRate() {
        let hz = 0;
        for (const view of this.actor.peek_stage_views() ?? [])
            hz = Math.max(hz, view.get_refresh_rate());
        return hz >= 20 ? hz : 60;
    }

    destroy() {
        if (this._timerId) GLib.source_remove(this._timerId);
        this._timerId = 0;
        for (const layer of this._layers.values()) layer.effect.onPaint = null;
        this._layers.clear();
        this.actor.destroy();
    }
}

/**
 * Whether windows on the current workspace hide a monitor's desktop: a
 * fullscreen one, or maximized and tiled ones between them. Clutter already
 * stops painting a background nothing can see, but a panel is not a window,
 * so the strip of desktop behind one keeps a covered monitor repainting in
 * full -- this is what lets it rest. Uncovering it repaints the desktop, and
 * that paint is what wakes the patterns again.
 */
function desktopCovered(index) {
    if (global.display.get_monitor_in_fullscreen(index)) return true;

    const area = Main.layoutManager.getWorkAreaForMonitor(index);
    const workspace = global.workspace_manager.get_active_workspace();
    let open = [area];
    for (const actor of global.get_window_actors()) {
        const win = actor.meta_window;
        if (win.minimized || !win.located_on_workspace(workspace) ||
            win.get_window_type() === Meta.WindowType.DESKTOP)
            continue;
        const rect = win.get_frame_rect();
        open = open.flatMap(o => subtract(o, rect));
        if (open.length === 0) return true;
    }
    const left = open.reduce((sum, o) => sum + o.width * o.height, 0);
    return left <= area.width * area.height * (1 - COVERED);
}

// What is left of rectangle a with b taken out: up to four pieces.
function subtract(a, b) {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    if (x1 >= x2 || y1 >= y2) return [a];

    const pieces = [];
    if (a.y < y1) pieces.push({ x: a.x, y: a.y, width: a.width, height: y1 - a.y });
    if (y2 < a.y + a.height) pieces.push({ x: a.x, y: y2, width: a.width, height: a.y + a.height - y2 });
    if (a.x < x1) pieces.push({ x: a.x, y: y1, width: x1 - a.x, height: y2 - y1 });
    if (x2 < a.x + a.width) pieces.push({ x: x2, y: y1, width: a.x + a.width - x2, height: y2 - y1 });
    return pieces;
}
