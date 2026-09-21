import cairo from 'cairo';

export const TAU = Math.PI * 2;

/**
 * Seeded PRNG (mulberry32) so layers layout consistently.
 */
export function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Smooth 2D value noise in [0, 1], plus a three-octave fractal sum of it.
 */
export function makeNoise(seed) {
    const rand = seeded(seed);
    const SIZE = 256;
    const perm = new Uint8Array(SIZE * 2);
    const lattice = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
        perm[i] = i;
        lattice[i] = rand();
    }
    for (let i = SIZE - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        const tmp = perm[i];
        perm[i] = perm[j];
        perm[j] = tmp;
    }
    for (let i = 0; i < SIZE; i++) {
        perm[i + SIZE] = perm[i];
    }

    const value = (ix, iy) => lattice[perm[(ix & 255) + perm[iy & 255]]];
    const fade = f => f * f * (3 - 2 * f);

    const at = (x, y) => {
        const ix = Math.floor(x);
        const iy = Math.floor(y);
        const fx = fade(x - ix);
        const fy = fade(y - iy);
        const a = value(ix, iy);
        const b = value(ix + 1, iy);
        const c = value(ix, iy + 1);
        const d = value(ix + 1, iy + 1);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };

    const fbm = (x, y) =>
        (at(x, y) * 0.5 + at(x * 2.03, y * 2.03) * 0.25 + at(x * 4.11, y * 4.11) * 0.125) / 0.875;

    return { at, fbm };
}

/**
 * Paint a square sprite into an offscreen cairo.ImageSurface once.
 */
export function sprite(size, paint) {
    const surf = new cairo.ImageSurface(cairo.Format.ARGB32, size, size);
    const cr = new cairo.Context(surf);
    cr.translate(size / 2, size / 2);
    paint(cr, size / 2);
    return surf;
}

/**
 * A soft glow sprite: bright white core fading to color.
 */
export function glowSprite(size, r, g, b, core = 0) {
    return sprite(size, (cr, radius) => {
        const grad = new cairo.RadialGradient(0, 0, 0, 0, 0, radius);
        grad.addColorStopRGBA(0, 1, 1, 1, 1);
        grad.addColorStopRGBA(Math.max(0.01, core), r, g, b, 0.9);
        grad.addColorStopRGBA(Math.min(1, core + (1 - core) * 0.45), r, g, b, 0.28);
        grad.addColorStopRGBA(1, r, g, b, 0);
        cr.setSource(grad);
        cr.paint();
    });
}

/**
 * Stamp a sprite surface onto the context at (x, y) with a given diameter.
 */
export function stamp(cr, surf, x, y, diameter) {
    const sw = surf.getWidth();
    const sh = surf.getHeight();
    cr.save();
    cr.translate(x - diameter / 2, y - diameter / 2);
    cr.scale(diameter / sw, diameter / sh);
    cr.setSourceSurface(surf, 0, 0);
    cr.paint();
    cr.restore();
}

/**
 * Stamp a sprite surface onto the context with custom alpha.
 */
export function stampWithAlpha(cr, surf, x, y, diameter, alpha) {
    if (alpha <= 0.002) return;
    const sw = surf.getWidth();
    const sh = surf.getHeight();
    cr.save();
    cr.translate(x - diameter / 2, y - diameter / 2);
    cr.scale(diameter / sw, diameter / sh);
    cr.setSourceSurface(surf, 0, 0);
    cr.paintWithAlpha(Math.min(1, Math.max(0, alpha)));
    cr.restore();
}

/**
 * Linear interpolation.
 */
export function lerp(a, b, f) {
    return a + (b - a) * f;
}

/**
 * Number of particles for a given screen dimension, bounded.
 */
export function countFor(w, h, per1080p, min = 12) {
    const share = (w * h) / (1920 * 1080);
    return Math.max(min, Math.round(per1080p * Math.min(1.6, Math.max(0.35, share))));
}

/**
 * Add a low-resolution buffer to the canvas, blown back up to fill it.
 *
 * The obvious way to do this is one call -- a scaled, filtered SurfacePattern
 * painted with `Operator.ADD` -- and it is the single most expensive thing in
 * the extension: cairo has a fast path for a filtered upscale and a fast path
 * for ADD, but none for the two together, so it falls back to a general loop
 * over every destination pixel. Measured on a 1440x810 canvas, one such call is
 * **8.1ms**; the same upscale with OVER is 2.7ms and an unscaled ADD is 0.5ms.
 *
 * So it is done in two passes instead -- scale into a full-size scratch buffer
 * with SOURCE, then add that buffer 1:1 -- for the same pixels in **1.7ms**.
 * The scratch is the engine's, one per canvas rather than one per layer, and is
 * fully overwritten by the SOURCE pass so it never needs clearing. Without one
 * (a layer driven outside the engine) this falls back to the slow single call.
 */
export function addScaled(cr, low, s, alpha) {
    const ow = low.getWidth();
    const oh = low.getHeight();
    const scratch = s.scratch;

    if (!scratch || scratch.getWidth() !== s.w || scratch.getHeight() !== s.h) {
        cr.save();
        cr.setOperator(cairo.Operator.ADD);
        const pat = new cairo.SurfacePattern(low);
        pat.setFilter(cairo.Filter.BILINEAR);
        cr.scale(s.w / ow, s.h / oh);
        cr.setSource(pat);
        cr.paintWithAlpha(alpha);
        cr.restore();
        return;
    }

    const scr = s.scratchCr;
    scr.save();
    scr.setOperator(cairo.Operator.SOURCE);
    const pat = new cairo.SurfacePattern(low);
    pat.setFilter(cairo.Filter.BILINEAR);
    scr.scale(s.w / ow, s.h / oh);
    scr.setSource(pat);
    scr.paint();
    scr.restore();

    cr.save();
    cr.setOperator(cairo.Operator.ADD);
    cr.setSourceSurface(scratch, 0, 0);
    cr.paintWithAlpha(alpha);
    cr.restore();
}
