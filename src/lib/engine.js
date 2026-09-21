import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import cairo from 'cairo';

import { getEffect } from './catalog.js';
import { paintPalette } from './palettes.js';

// A repaint costs about twice what the draw handler does. The other half is the
// compositing and texture upload that a whole damaged monitor causes, which
// happens somewhere nothing here can time it -- so it is measured from the
// outside instead: on this desk, an idle shell sits at 2% of a core and native
// pacing at 40%, of which 19% was timed inside the draw handlers.
const DRAW_AMPLIFICATION = 2.0;

// Over this much of the budget, give a frame back. Under this much of it after
// the next step up, take one -- the gap between the two is what stops the clock
// flipping between two rates for ever.
const BUDGET_OVER = 1.15;
const BUDGET_UNDER = 0.85;

// And quick to give, slow to take: a divisor of 1 or 2 cannot be nudged, only
// halved, so taking a frame back on the strength of one calm second is how the
// rate ends up visibly stepping up and down all afternoon. Backing off stays
// responsive -- that one is about the desktop, not about us.
const YIELD_DWELL_US = 1500000;
const CLAIM_DWELL_US = 6000000;

// Whatever the budget says, back off if the shell is this close to saturating
// its main thread -- something else needs it more than a wallpaper does.
const SHELL_SATURATED = 0.85;

// Below this the pattern is a slideshow, and the frames are no longer the thing
// worth trading away.
const MIN_PACED_FPS = 20;

// -- but a floor on the rate is not a floor on the cost, and a stack of
// expensive patterns can put one frame beyond what MIN_PACED_FPS of them a
// second can afford. Then the lowest rate the clock allowed itself still
// saturated the compositor, for ever, with the governor already at the bottom
// of its range: a desktop that has stopped answering the keyboard. So when a
// single frame is measurably that expensive the rate keeps falling, down to
// here, where it is a slideshow but the machine is still usable.
const MIN_SAFE_FPS = 4;

// A cpu-budget of 0 means "no limit", and it is honoured -- but not as far as
// handing the whole main thread to a wallpaper. This is not a budget, it is the
// point past which the shell stops being able to do anything else.
const DEADLOCK_GUARD = 0.9;

// The governor decides once a second off a smoothed average, which is right for
// following the weather and far too slow to catch a frame that has just tripled
// in cost -- four seconds of frozen desktop before it even reacts. The brake
// below acts on a single measured frame instead, no more often than this.
const BRAKE_COOLDOWN_US = 250000;

// A frame this slow is a stall the user can feel -- the pointer included, since
// this is the thread that moves it. Past here the brake acts whatever the
// averages think, because an average that says this is affordable is an average
// that has not caught up yet.
const STALL_FRAME_US = 50000;

// Linux accounts /proc times in a fixed 100Hz tick regardless of the kernel's
// own HZ, so this is a constant rather than a sysconf call we cannot make.
const USER_HZ = 100;

/**
 * What the shell is spending, and how much of it is ours.
 *
 * Two numbers, because neither is enough on its own. The draw handlers can be
 * timed directly, but they are only part of the bill: every repaint also damages
 * a full monitor, which the compositor then has to upload and recomposite, and
 * that costs about as much again where we cannot see it. So the ceiling is the
 * shell's own CPU time out of /proc -- the honest total, the thing the user
 * feels -- and the timed share is what tells us how much of it to blame on the
 * wallpaper before taking frames away from it.
 */
const pacer = {
    _busyUs: 0,
    _sinceUs: 0,
    _cpuTicks: 0,
    _draw: 0,
    _cpu: 0,

    report(us) {
        if (!this._sinceUs) {
            this._sinceUs = GLib.get_monotonic_time();
            this._cpuTicks = readCpuTicks();
        }
        this._busyUs += us;
    },

    /**
     * `draw` is the share of wall-clock time spent inside draw handlers, `cpu`
     * the whole shell's CPU time as a fraction of one core. Both are averages
     * over the last second or so; a call before that window is up gets the
     * previous one back rather than a noisier answer.
     */
    sample() {
        const now = GLib.get_monotonic_time();
        if (!this._sinceUs) {
            this._sinceUs = now;
            this._cpuTicks = readCpuTicks();
            return { draw: this._draw, cpu: this._cpu };
        }

        const elapsed = now - this._sinceUs;
        if (elapsed < 1000000) return { draw: this._draw, cpu: this._cpu };

        const ticks = readCpuTicks();
        this._draw = this._busyUs / elapsed;
        if (ticks && this._cpuTicks)
            this._cpu = ((ticks - this._cpuTicks) / USER_HZ) / (elapsed / 1000000);

        this._busyUs = 0;
        this._cpuTicks = ticks;
        this._sinceUs = now;
        return { draw: this._draw, cpu: this._cpu };
    },
};

/** The shell's own user + system time, in 100Hz ticks. */
function readCpuTicks() {
    try {
        const [ok, bytes] = GLib.file_get_contents('/proc/self/stat');
        if (!ok) return 0;
        // The second field is the command name, in brackets, and may contain
        // spaces of its own -- so count from the end of it, where utime and
        // stime are the 12th and 13th of what is left.
        const line = new TextDecoder().decode(bytes);
        const fields = line.slice(line.lastIndexOf(')') + 2).split(' ');
        const ticks = Number(fields[11]) + Number(fields[12]);
        return Number.isFinite(ticks) ? ticks : 0;
    } catch (e) {
        return 0;
    }
}

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
        this._surfaceW = 0;
        this._surfaceH = 0;
        this._scratch = null;
        this._scratchCr = null;

        // Native pacing: the monitor's own refresh rate, how many of its frames
        // go by between paints, and the deadline the next one is due at.
        this._native = 0;
        this._baseDivisor = 1;
        this._divisor = 1;
        this._frameUs = 0;
        this._dueUs = 0;
        this._repaceAtUs = 0;
        this._load = 0;
        this._frameCostUs = 0;
        this._brakedAtUs = 0;
        this._braking = true;
        this._retime = false;
        this._changedAtUs = 0;
        this._requested = 0;
        this._painted = 0;

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

        // The base normally belongs to the shell's own wallpaper (background.js),
        // which puts it everywhere a wallpaper is shown. This canvas is what is
        // left if that could not be taken over: a still gradient of its own, kept
        // apart from the pattern canvas so it is neither repainted every frame
        // nor faded by the pattern opacity.
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
                if (this._state.mode === 'color' && !this._state.nativeBase)
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
        this._base.visible = this._state.mode === 'color' && !this._state.nativeBase;
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

        // One canvas-sized scratch buffer, lent to any layer that needs to blow
        // a low-resolution buffer back up -- see `addScaled` in layer.js, where
        // the reason it is worth 8ms a frame is written down. One per canvas
        // rather than one per layer, since no layer holds it between frames.
        this._scratch = new cairo.ImageSurface(cairo.Format.ARGB32, sw, sh);
        this._scratchCr = new cairo.Context(this._scratch);

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

        if (this._state.mode === 'image' && this._state.customImage && !this._state.nativeBase) {
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

        // What a frame costs is about to change, and the brake reads that
        // number to decide how far the clock may fall -- so a stale one would
        // either pin the rate down after patterns were removed or let a much
        // more expensive stack run a full frame before anything noticed.
        if (next.size !== this._layers.size ||
            [...next.keys()].some(id => !this._layers.has(id)))
            this._frameCostUs = 0;

        this._layers = next;
    }

    updateState(newState) {
        const fpsChanged = newState.targetFps !== this._state.targetFps ||
            newState.cpuBudget !== this._state.cpuBudget;
        this._state = newState;

        // Anything the user just changed can step the cost -- another pattern,
        // a higher render scale, a different budget -- and the governor's
        // smoothed average is about the configuration that has just been
        // replaced. Lead with the brake again until there is a fresh one.
        this._braking = true;

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

    // ------------------------------------------------------------------
    // The frame clock
    // ------------------------------------------------------------------

    /**
     * Starts pacing repaints.
     *
     * `target-fps` is either a plain rate or, at zero and below, a share of what
     * this monitor actually does: every frame it shows, every other one, every
     * third. That is the whole point of reading the refresh rate -- 60 frames a
     * second on a 240Hz panel is not 60 evenly spaced frames, it is one frame
     * held for four refreshes and the next for five, which reads as judder no
     * matter how fast the panel is. A share of the rate divides evenly and does
     * not.
     *
     * Pacing does NOT go through the frame clock, tempting as a Clutter timeline
     * bound to the actor looks. A running timeline asks the compositor for every
     * frame the display can show, forever, whether we intend to paint into it or
     * not -- and measured here, holding a 240Hz clock open cost 97% of a core
     * against 32% for the same number of paints on a timer. So we stay on a
     * timer and let mutter sleep between our repaints.
     */
    _startClock() {
        if (this._timerId) return;

        const target = this._state.targetFps ?? 0;
        if (target > 0) {
            this._native = 0;
            this._baseDivisor = 1;
            this._divisor = 1;
            this._startTimer(Math.max(5, Math.min(480, target)));
            return;
        }

        // 0 is every frame the display shows, -2 every other one, -3 every third.
        this._baseDivisor = target === 0 ? 1 : Math.max(1, Math.min(8, -target));

        // The shell only knows which view an actor is on once it has painted it,
        // and nothing has yet -- so this is usually a guess on the first pass,
        // and asked again a second later.
        const hz = this._findNativeRate();
        this._native = hz || 60;
        this._rateIsGuess = !hz;

        // Opening at a 240Hz display's full rate would mean a second of badly
        // overloaded desktop before the governor could react, so start where a
        // 60Hz screen would and let it climb from there if there is room. With no
        // budget to keep there is nothing to climb towards: go straight there.
        const opening = this._state.cpuBudget > 0
            ? Math.max(this._baseDivisor, Math.round(this._native / 60))
            : this._baseDivisor;
        this._divisor = Math.min(this._maxDivisor(), opening);

        console.log(`[WallpaperEngine] Monitor ${this.monitor.index}: ` +
            `display runs at ${this._native.toFixed(2)} Hz, opening at ` +
            `${(this._native / this._divisor).toFixed(0)} FPS`);

        this._startTimer(this._native / this._divisor);
    }

    /**
     * A timer that keeps an exact average rate.
     *
     * GLib intervals are whole milliseconds, and the rates worth hitting are not:
     * a quarter of 239.76Hz is 16.68ms, and rounding it to 17 is a 2% drift that
     * shows up as a frame held too long every few seconds. So the timer runs a
     * little fast and each frame is painted against a deadline carried forward
     * from the last one, which averages out exactly.
     */
    _startTimer(fps) {
        this._frameUs = 1000000 / fps;
        this._dueUs = 0;

        const intervalMs = Math.max(1, Math.floor(1000 / fps));
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, () => {
            if (!this._container || !this._area) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }

            if (this._isIdle()) {
                // Resume from where the animation stopped rather than jumping
                // forward by however long the pause lasted.
                this._lastFrameTime = 0;
                this._dueUs = 0;
                return GLib.SOURCE_CONTINUE;
            }

            const now = GLib.get_monotonic_time();
            if (this._dueUs && now < this._dueUs - 500) return GLib.SOURCE_CONTINUE;

            // Carried forward from the deadline rather than from now, so the
            // rate does not drift; resynced if we fell a whole frame behind.
            this._dueUs = (this._dueUs || now) + this._frameUs;
            if (this._dueUs < now) this._dueUs = now + this._frameUs;

            this._brake();
            this._maintain();
            this._advance();

            // A new rate needs a new source: this one is pacing to the old one,
            // and removing it from inside its own dispatch is what the return
            // value is for.
            if (this._retime) {
                this._retime = false;
                this._startTimer(this._native / this._divisor);
                return GLib.SOURCE_REMOVE;
            }

            return GLib.SOURCE_CONTINUE;
        });
    }

    /** The share of a core this monitor may spend, honouring "no limit". */
    _share() {
        const budget = this._state.cpuBudget;
        if (!(budget > 0)) return DEADLOCK_GUARD;
        return budget / Math.max(1, this._state.monitorCount || 1);
    }

    /**
     * The emergency brake: one frame, acted on at once.
     *
     * The governor below is an averaging thing -- a second to take a sample,
     * more to smooth it, a dwell before it will move -- and that is right for
     * following a load that drifts. It is useless against a load that steps,
     * which is exactly what enabling another pattern does. Four expensive
     * patterns on a 240Hz head ask for several times the main thread the moment
     * the checkbox is ticked, and the main thread is where the keyboard and the
     * mouse are: by the time the governor had a number to act on, the desktop
     * had been frozen for four seconds.
     *
     * So this runs on every tick, off a single measured frame, and jumps
     * straight to a rate that fits rather than stepping towards one.
     */
    _brake() {
        if (!this._native) return;              // a fixed rate is the user's call
        if (!this._frameCostUs || !this._frameUs) return;

        // Once the governor has weighed this configuration against the shell's
        // real CPU time, it is the better judge and this stands down: /proc is
        // what the machine actually spent, where the figure below is a frame
        // time times a guess at the compositing behind it. Left both running,
        // they simply take turns -- the governor climbing on the true number,
        // the brake pulling it back on the estimate, every few seconds for ever.
        // Re-armed by `updateState` whenever the settings move the cost.
        if (!this._braking && this._frameCostUs < STALL_FRAME_US) return;

        const now = GLib.get_monotonic_time();
        if (now - this._brakedAtUs < BRAKE_COOLDOWN_US) return;

        // What one frame really costs: the drawing, plus the damage and
        // recompositing of a whole monitor that follows it.
        const load = (this._frameCostUs * DRAW_AMPLIFICATION) / this._frameUs;
        const share = this._share();
        if (load <= share * BUDGET_OVER) return;

        const want = Math.min(this._maxDivisor(), Math.ceil(this._divisor * load / share));
        if (want <= this._divisor) return;

        const before = this._divisor;
        this._divisor = want;
        this._brakedAtUs = now;
        // Claimed as a rate change so the governor respects its own dwell and
        // does not spend the next second undoing this.
        this._changedAtUs = now;
        this._retime = true;

        console.log(`[WallpaperEngine] Monitor ${this.monitor.index}: a frame took ` +
            `${(this._frameCostUs / 1000).toFixed(1)}ms against a ` +
            `${(this._frameUs / 1000).toFixed(1)}ms budget -- braking from every ` +
            `${before} to every ${want} frame, ${(this._native / want).toFixed(0)} FPS`);
    }

    /**
     * Native pacing is a promise about smoothness, not about spending the whole
     * compositor on a wallpaper.
     *
     * Once a second, if the shell is using more CPU than a background should,
     * this gives a frame back -- every other frame of the display instead of
     * every one, then every third -- and keeps going until it fits. It climbs
     * again when the load falls: a cheaper pattern, a lower render scale, the
     * other monitor going idle, or whatever else was busy finishing.
     */
    _maintain() {
        if (!this._native) return;                  // a fixed rate needs nothing

        const now = GLib.get_monotonic_time();
        if (!this._repaceAtUs) {
            this._repaceAtUs = now + 1000000;
            return;
        }
        if (now < this._repaceAtUs) return;
        this._repaceAtUs = now + 1000000;

        this._confirmRate();
        this._repace(now);
    }

    /**
     * Asks again for the refresh rate the clock had to guess at.
     *
     * Worth the second look: a 240Hz panel mistaken for a 60Hz one is a quarter
     * of the frames it could have, and silently -- the motion is smooth, just
     * four times slower to update than the display can manage.
     */
    _confirmRate() {
        if (!this._rateIsGuess) return;

        const hz = this._findNativeRate();
        if (!hz) return;                            // still nothing painted

        if (hz === this._native) {
            this._rateIsGuess = false;
            return;
        }

        // Hold the rate the wallpaper is actually running at across the
        // correction, rather than quadrupling it the moment the truth arrives.
        // Scaled against the new rate, and clamped by what the measured frame
        // cost can afford at it -- clamping to the plain MIN_PACED_FPS floor
        // here would throw away a brake that had already been applied, and hand
        // the rate straight back to the stack that could not afford it.
        const scaled = Math.round(this._divisor * hz / this._native);
        this._native = hz;
        const divisor = Math.max(this._baseDivisor, Math.min(this._maxDivisor(), scaled));

        this._rateIsGuess = false;
        this._divisor = divisor;
        this._retime = true;

        console.log(`[WallpaperEngine] Monitor ${this.monitor.index}: display runs at ` +
            `${hz.toFixed(2)} Hz after all, every ${divisor} frame${divisor === 1 ? '' : 's'} ` +
            `-- ${(hz / divisor).toFixed(0)} FPS`);
    }

    _repace(now) {
        const budget = this._state.cpuBudget;
        if (!(budget > 0)) return;                  // no limit to keep

        const { draw, cpu } = pacer.sample();
        if (!draw) return;

        // A real measurement of this configuration exists now, so the brake's
        // estimate is no longer the best thing available.
        if (cpu) this._braking = false;

        // Clutter culls an actor nothing can see, so the draw handler stops being
        // called while a window covers the desktop -- the canvas looks free, and
        // every cost read in that window is about somebody else's work. Nothing
        // to learn from, and climbing on it only means backing off again the
        // moment the desktop is visible.
        const painted = this._painted;
        const requested = this._requested;
        this._painted = 0;
        this._requested = 0;
        if (requested && painted < requested * 0.5) return;

        // What the wallpaper costs, across every monitor: the timed drawing and
        // the compositing it drags along behind it -- but never more than the
        // shell actually spent, whatever the estimate says.
        const cost = cpu ? Math.min(cpu, draw * DRAW_AMPLIFICATION) : draw * DRAW_AMPLIFICATION;

        // Averaged over a few windows before anything is decided on it. A single
        // second is a noisy thing to re-time a clock from: an app launching, a
        // window covering the desktop so Clutter culls the canvas away, a
        // notification animating. The rate should follow the weather, not the
        // gusts.
        this._load = this._load ? this._load * 0.6 + cost * 0.4 : cost;
        const ours = this._load;

        // Cost is linear in the frame rate, so the ratio is the answer: at twice
        // the budget, paint on half as many frames. Every monitor reads the same
        // total and scales its own divisor by it, which keeps a cheap head and an
        // expensive one in proportion instead of punishing them equally.
        let want = this._divisor * ours / budget;

        // Courtesy: something else is using the thread we are decorating.
        if (cpu > SHELL_SATURATED && ours > 0.1)
            want = Math.max(want, this._divisor + 1);

        const ratio = want / this._divisor;
        const before = this._divisor;
        const since = now - (this._changedAtUs || 0);

        if (ratio > BUDGET_OVER) {
            if (since < YIELD_DWELL_US) return;
            this._divisor = Math.min(this._maxDivisor(), Math.ceil(want));
        } else if (this._divisor > this._baseDivisor && since >= CLAIM_DWELL_US) {
            // Painting on more frames multiplies the cost by divisor/(divisor-1),
            // and no divisor lands exactly on the budget -- so asking whether we
            // are under it is how a clock ends up flipping between 60 and 30 FPS
            // every other second. Ask whether the next step up would still fit.
            const next = this._divisor - 1;
            if (ours * this._divisor / next > budget * BUDGET_UNDER) return;
            this._divisor = next;
        }

        if (this._divisor === before) return;
        this._changedAtUs = now;

        const fps = this._native / this._divisor;
        console.log(`[WallpaperEngine] Monitor ${this.monitor.index}: patterns cost ` +
            `${Math.round(ours * 100)}% of a core against a ${Math.round(budget * 100)}% budget ` +
            `(shell total ${Math.round(cpu * 100)}%), now every ${this._divisor} ` +
            `frame${this._divisor === 1 ? '' : 's'} -- ${fps.toFixed(0)} FPS`);

        this._retime = true;
    }

    /**
     * How far the clock is allowed to fall.
     *
     * Normally MIN_PACED_FPS, below which the motion costs more than the CPU it
     * saves. But that is a floor on the *rate*, and the cost is what actually
     * has to fit: if one frame alone is too expensive to afford even
     * MIN_PACED_FPS of them, holding that rate means saturating the compositor
     * for ever with nothing left to give. Then the cost wins.
     */
    _maxDivisor() {
        const native = this._native || 60;
        let floorFps = MIN_PACED_FPS;

        if (this._frameCostUs) {
            const perFrame = (this._frameCostUs * DRAW_AMPLIFICATION) / 1000000;
            const affordable = this._share() / perFrame;
            if (affordable < floorFps) floorFps = Math.max(MIN_SAFE_FPS, affordable);
        }

        return Math.max(this._baseDivisor, Math.floor(native / floorFps));
    }

    /**
     * The refresh rate of the monitor this canvas is painted on.
     *
     * Per monitor, which is the point: nothing else here can tell a 240Hz head
     * from the 60Hz one beside it. The actor has to have been painted at least
     * once for the shell to know which view it is on, so this is worth asking
     * again later if it comes back empty.
     */
    _findNativeRate() {
        let hz = 0;
        try {
            const views = this._area?.peek_stage_views?.() ?? [];
            for (const view of views) hz = Math.max(hz, view.get_refresh_rate());
        } catch (e) {
            // Private-ish Clutter API. Without it there is no native rate to
            // follow, so 60 it is.
        }
        return hz >= 20 ? hz : 0;
    }

    /** Advances the animation clock and asks for one repaint. */
    _advance() {
        const now = GLib.get_monotonic_time() / 1000000;
        if (this._lastFrameTime === 0) {
            this._lastFrameTime = now;
            return;
        }

        const delta = now - this._lastFrameTime;
        this._lastFrameTime = now;

        const clampedDelta = Math.min(delta, 0.05);
        this._dt = clampedDelta;
        this._time += clampedDelta * (this._state.speed || 1.0);

        this._requested++;
        this._area.queue_repaint();
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

        const scene = {
            w, h, t: this._time, dt: this._dt,
            scratch: this._scratch, scratchCr: this._scratchCr,
        };
        const startedUs = GLib.get_monotonic_time();
        this._painted++;

        for (const layer of this._layers.values()) {
            cr.save();
            try {
                layer.draw(cr, scene);
            } catch (e) {
                console.error(`[WallpaperEngine] Layer draw error: ${e}`);
            }
            cr.restore();
        }

        // This is the number that decides how often we are allowed to do it
        // again -- see the pacer at the top of the file.
        const us = GLib.get_monotonic_time() - startedUs;
        pacer.report(us);

        // Quick to rise and slow to fall, because this one feeds the brake and
        // the frame it has to catch is the expensive one, not the average.
        this._frameCostUs = Math.max(us, this._frameCostUs * 0.92);
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
        this._scratch = null;
        this._scratchCr = null;
    }
}
