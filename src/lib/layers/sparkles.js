import cairo from 'cairo';
import { TAU, countFor, glowSprite, seeded, stampWithAlpha } from '../layer.js';

const R = 225 / 255;
const G = 238 / 255;
const B = 255 / 255;

export class SparklesLayer {
    constructor() {
        this._glow = glowSprite(48, R, G, B, 0.12);
        this._specks = [];
    }

    resize(w, h) {
        const rand = seeded(7);
        const count = countFor(w, h, 90);
        this._specks = Array.from({ length: count }, () => {
            const z = rand() * rand();
            return {
                x: rand(),
                y: rand(),
                z,
                vx: (0.006 + 0.02 * z) * (0.7 + rand() * 0.6),
                vy: -(0.003 + 0.012 * z) * (0.7 + rand() * 0.6),
                sw: rand() * TAU,
                sws: 0.2 + rand() * 0.5,
            };
        });
    }

    draw(cr, s) {
        cr.save();
        cr.setOperator(cairo.Operator.ADD);

        for (const p of this._specks) {
            p.x += p.vx * s.dt + Math.sin(s.t * p.sws + p.sw) * 0.004 * s.dt;
            p.y += p.vy * s.dt;
            if (p.x > 1.04) p.x -= 1.08;
            if (p.x < -0.04) p.x += 1.08;
            if (p.y < -0.04) p.y += 1.08;

            const alpha = 0.22 + 0.5 * p.z;
            stampWithAlpha(cr, this._glow, p.x * s.w, p.y * s.h, 3 + p.z * 8, alpha);
        }

        cr.restore();
    }
}
