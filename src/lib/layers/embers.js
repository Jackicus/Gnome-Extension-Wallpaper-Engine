import cairo from 'cairo';
import { TAU, countFor, glowSprite, makeNoise, seeded, stampWithAlpha } from '../layer.js';

const COOLING = [
    [1.0, 240 / 255, 200 / 255],
    [1.0, 160 / 255, 60 / 255],
    [1.0, 90 / 255, 30 / 255],
];

export class EmbersLayer {
    constructor() {
        this._sprites = COOLING.map(([r, g, b]) => glowSprite(32, r, g, b, 0.25));
        this._noise = makeNoise(67);

        // Bottom heat glow
        this._heat = new cairo.ImageSurface(cairo.Format.ARGB32, 1, 128);
        const cr = new cairo.Context(this._heat);
        const grad = new cairo.LinearGradient(0, 0, 0, 128);
        grad.addColorStopRGBA(0, 1.0, 120 / 255, 40 / 255, 0);
        grad.addColorStopRGBA(1, 1.0, 120 / 255, 40 / 255, 0.28);
        cr.setSource(grad);
        cr.paint();

        this._sparks = [];
        this._rand = seeded(67);
    }

    _spawn(fresh) {
        const r = this._rand;
        const life = 4 + r() * 5;
        return {
            x: r(),
            y: fresh ? r() : 1.02 + r() * 0.06,
            rise: 0.035 + r() * 0.07,
            size: 2 + r() * r() * 5,
            life,
            age: fresh ? r() * life : 0,
            flick: r() * TAU,
            flickRate: 6 + r() * 10,
        };
    }

    resize(w, h) {
        this._rand = seeded(67);
        this._sparks = Array.from({ length: countFor(w, h, 110, 30) }, () => this._spawn(true));
    }

    draw(cr, s) {
        cr.save();
        cr.setOperator(cairo.Operator.ADD);

        // Warm bottom fire glow
        const heatAlpha = 0.5 + 0.15 * Math.sin(s.t * 0.7) + 0.08 * Math.sin(s.t * 2.3);
        const heatH = s.h * 0.28;
        cr.save();
        cr.translate(0, s.h - heatH);
        cr.scale(s.w, heatH / 128);
        cr.setSourceSurface(this._heat, 0, 0);
        cr.paintWithAlpha(heatAlpha);
        cr.restore();

        for (let i = 0; i < this._sparks.length; i++) {
            const p = this._sparks[i];
            p.age += s.dt;
            if (p.age > p.life || p.y < -0.05) {
                this._sparks[i] = this._spawn(false);
                continue;
            }

            const f = p.age / p.life;
            const push = (this._noise.at(p.x * 6 + s.t * 0.15, p.y * 6 - s.t * 0.3) - 0.5) * 0.12;
            p.x += push * s.dt;
            p.y -= p.rise * (1.3 - f * 0.6) * s.dt;

            const flicker = 0.7 + 0.3 * Math.sin(s.t * p.flickRate + p.flick);
            const alpha = Math.pow(1 - f, 0.7) * flicker * 0.9;
            const stage = f < 0.3 ? 0 : f < 0.7 ? 1 : 2;

            stampWithAlpha(cr, this._sprites[stage], p.x * s.w, p.y * s.h, p.size * (2.4 - f), alpha);
        }

        cr.restore();
    }
}
