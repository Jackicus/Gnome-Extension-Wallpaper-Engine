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
