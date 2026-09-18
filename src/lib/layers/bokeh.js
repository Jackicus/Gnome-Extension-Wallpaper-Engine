import cairo from 'cairo';
import { TAU, countFor, seeded, sprite, stampWithAlpha } from '../layer.js';

const TINTS = [
    [1.0, 236 / 255, 210 / 255],
    [205 / 255, 225 / 255, 1.0],
    [235 / 255, 205 / 255, 1.0],
];

function discSprite(rgb) {
    const [r, g, b] = rgb;
    return sprite(128, (cr, radius) => {
        const grad = new cairo.RadialGradient(0, 0, 0, 0, 0, radius);
        grad.addColorStopRGBA(0, r, g, b, 0.32);
        grad.addColorStopRGBA(0.72, r, g, b, 0.36);
        grad.addColorStopRGBA(0.9, r, g, b, 0.7);
        grad.addColorStopRGBA(1, r, g, b, 0);
        cr.setSource(grad);
        cr.paint();
    });
}

export class BokehLayer {
    constructor() {
        this._sprites = TINTS.map(discSprite);
        this._discs = [];
        this._rand = seeded(23);
    }

    _spawn(fresh) {
        const r = this._rand;
        const size = 24 + r() * r() * 130;
        return {
            x: r(),
            y: fresh ? r() : 1.1,
            size,
            speed: 0.008 + (60 / size) * 0.012,
            sway: 0.01 + r() * 0.02,
            swayRate: 0.15 + r() * 0.35,
            phase: r() * TAU,
            life: 9 + r() * 9,
            age: fresh ? r() * 8 : 0,
            tint: Math.floor(r() * TINTS.length),
        };
    }

    resize(w, h) {
        this._rand = seeded(23);
        this._discs = Array.from({ length: countFor(w, h, 26, 8) }, () => this._spawn(true));
    }

    draw(cr, s) {
        cr.save();
        cr.setOperator(cairo.Operator.ADD);

        for (let i = 0; i < this._discs.length; i++) {
            const d = this._discs[i];
            d.age += s.dt;
            d.y -= d.speed * s.dt;
            if (d.age > d.life || d.y < -0.2) {
                this._discs[i] = this._spawn(false);
                continue;
            }

            const f = d.age / d.life;
            const fade = Math.min(1, f * 5, (1 - f) * 5);
            const x = (d.x + Math.sin(s.t * d.swayRate + d.phase) * d.sway) * s.w;
            const alpha = fade * (0.08 + 0.1 * (1 - d.size / 160));

            stampWithAlpha(cr, this._sprites[d.tint], x, d.y * s.h, d.size, alpha);
        }

        cr.restore();
    }
}
