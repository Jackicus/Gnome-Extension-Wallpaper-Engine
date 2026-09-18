import cairo from 'cairo';
import { makeNoise } from '../layer.js';

const SCALE = 5;
// Curtains are painted one strip at a time into the low-res buffer, and each
// strip is a cairo paint of its own. The buffer is blown up by SCALE on the way
// out, so strips narrower than this cost paint calls for detail nothing can see.
const STRIDE = 2;

const CURTAINS = [
    { rgb: [150 / 255, 110 / 255, 255 / 255], hang: 0.34, wander: 0.14, minLen: 0.16, maxLen: 0.5, alpha: 0.55, drift: 0.018, seed: 31 },
    { rgb: [70 / 255, 235 / 255, 160 / 255], hang: 0.42, wander: 0.1, minLen: 0.1, maxLen: 0.36, alpha: 0.85, drift: 0.03, seed: 17 },
];

function curtainStrip(rgb) {
    const [r, g, b] = rgb;
    const strip = new cairo.ImageSurface(cairo.Format.ARGB32, 1, 128);
    const cr = new cairo.Context(strip);
    const grad = new cairo.LinearGradient(0, 0, 0, 128);
    grad.addColorStopRGBA(0, r, g, b, 0);
    grad.addColorStopRGBA(0.5, r, g, b, 0.22);
    grad.addColorStopRGBA(0.9, r, g, b, 0.9);
    grad.addColorStopRGBA(1, r, g, b, 0.15);
    cr.setSource(grad);
    cr.paint();
    return strip;
}

export class AuroraLayer {
    constructor() {
        this._strips = CURTAINS.map(c => curtainStrip(c.rgb));
        this._noises = CURTAINS.map(c => makeNoise(c.seed));
        this._low = null;
        this._lowCr = null;
    }

    resize(w, h) {
        const lw = Math.max(1, Math.ceil(w / SCALE));
        const lh = Math.max(1, Math.ceil(h / SCALE));
        this._low = new cairo.ImageSurface(cairo.Format.ARGB32, lw, lh);
        this._lowCr = new cairo.Context(this._low);
    }

    draw(cr, s) {
        if (!this._low) return;
        const ow = this._low.getWidth();
        const oh = this._low.getHeight();

        const lowCr = this._lowCr;
        lowCr.save();
        lowCr.setOperator(cairo.Operator.CLEAR);
        lowCr.paint();
        lowCr.restore();

        lowCr.save();
        lowCr.setOperator(cairo.Operator.ADD);

        const breathe = 0.75 + 0.25 * Math.sin(s.t * 0.13);
        for (let c = 0; c < CURTAINS.length; c++) {
            const cur = CURTAINS[c];
            const noise = this._noises[c];
            const strip = this._strips[c];
            const shift = s.t * cur.drift;

            for (let x = 0; x < ow; x += STRIDE) {
                const u = x / ow;
                const hang = noise.fbm(u * 1.6 + shift, 3.3 + s.t * 0.02) - 0.5;
                const len = noise.fbm(u * 2.4 - shift * 1.3, 9 + s.t * 0.05);
                const rays = noise.at(u * 38 + s.t * 0.12, 20 + s.t * 0.35);
                const bottom = (cur.hang + hang * 2 * cur.wander) * oh;
                const height = (cur.minLen + (cur.maxLen - cur.minLen) * len) * oh;
                const alpha = cur.alpha * breathe * (0.3 + 0.7 * rays);

                if (height > 1 && alpha > 0.01) {
                    lowCr.save();
                    lowCr.translate(x, bottom - height);
                    lowCr.scale(Math.min(STRIDE, ow - x), height / 128);
                    lowCr.setSourceSurface(strip, 0, 0);
                    lowCr.paintWithAlpha(alpha);
                    lowCr.restore();
                }
            }
        }
        lowCr.restore();

        // Bilinear upscale to main canvas
        cr.save();
        cr.setOperator(cairo.Operator.ADD);
        const pat = new cairo.SurfacePattern(this._low);
        pat.setFilter(cairo.Filter.BILINEAR);
        cr.scale(s.w / ow, s.h / oh);
        cr.setSource(pat);
        cr.paintWithAlpha(0.85);
        cr.restore();
    }
}
