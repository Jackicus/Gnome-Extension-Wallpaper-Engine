import cairo from 'cairo';
import { TAU, addScaled, glowSprite, seeded, stampWithAlpha } from '../layer.js';

const SCALE = 8;
const HUES = [
    [140 / 255, 90 / 255, 255 / 255],
    [50 / 255, 200 / 255, 220 / 255],
    [230 / 255, 80 / 255, 180 / 255],
    [60 / 255, 120 / 255, 255 / 255],
];

export class NebulaLayer {
    constructor() {
        this._sprites = HUES.map(([r, g, b]) => glowSprite(128, r, g, b, 0));
        this._low = null;
        this._lowCr = null;
        this._clouds = [];

        const rand = seeded(41);
        this._clouds = Array.from({ length: 14 }, (_, i) => ({
            cx: 0.1 + rand() * 0.8,
            cy: 0.1 + rand() * 0.8,
            ax: 0.08 + rand() * 0.2,
            ay: 0.06 + rand() * 0.16,
            fx: 0.03 + rand() * 0.05,
            fy: 0.025 + rand() * 0.05,
            px: rand() * TAU,
            py: rand() * TAU,
            size: 0.45 + rand() * 0.55,
            pulse: rand() * TAU,
            hue: i % HUES.length,
            lobes: [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5],
        }));
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
        const unit = Math.min(ow, oh);

        for (const c of this._clouds) {
            const x = (c.cx + Math.sin(s.t * c.fx + c.px) * c.ax) * ow;
            const y = (c.cy + Math.sin(s.t * c.fy + c.py) * c.ay) * oh;
            const size = c.size * unit * (0.92 + 0.08 * Math.sin(s.t * 0.2 + c.pulse));
            const img = this._sprites[c.hue];

            stampWithAlpha(lowCr, img, x, y, size, 0.16);
            stampWithAlpha(lowCr, img, x + c.lobes[0] * size * 0.7, y + c.lobes[1] * size * 0.7, size * 0.75, 0.11);
            stampWithAlpha(lowCr, img, x + c.lobes[2] * size * 0.7, y + c.lobes[3] * size * 0.7, size * 0.6, 0.11);
        }
        lowCr.restore();

        addScaled(cr, this._low, s, 0.9);
    }
}
