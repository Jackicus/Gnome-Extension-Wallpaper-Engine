import cairo from 'cairo';
import { TAU, countFor, glowSprite, seeded, stamp } from '../layer.js';

const R = 200 / 255;
const G = 222 / 255;
const B = 255 / 255;
const LINK = 150;
const MARGIN = 40;

export class ConstellationLayer {
    constructor() {
        this._dot = glowSprite(24, R, G, B, 0.3);
        this._points = [];
        this._w = 0;
        this._h = 0;
    }

    resize(w, h) {
        this._w = w;
        this._h = h;
        const rand = seeded(53);
        this._points = Array.from({ length: countFor(w, h, 70, 20) }, () => {
            const heading = rand() * TAU;
            const pace = 6 + rand() * 12;
            return {
                x: rand() * w,
                y: rand() * h,
                vx: Math.cos(heading) * pace,
                vy: Math.sin(heading) * pace,
                size: 3 + rand() * 4,
            };
        });
    }

    draw(cr, s) {
        const pts = this._points;
        for (const p of pts) {
            p.x += p.vx * s.dt;
            p.y += p.vy * s.dt;
            if (p.x < -MARGIN) p.x += this._w + MARGIN * 2;
            else if (p.x > this._w + MARGIN) p.x -= this._w + MARGIN * 2;
            if (p.y < -MARGIN) p.y += this._h + MARGIN * 2;
            else if (p.y > this._h + MARGIN) p.y -= this._h + MARGIN * 2;
        }

        cr.save();
        cr.setOperator(cairo.Operator.ADD);
        cr.setLineWidth(1);

        for (let i = 0; i < pts.length; i++) {
            const a = pts[i];
            for (let j = i + 1; j < pts.length; j++) {
                const b = pts[j];
                const dx = a.x - b.x;
                if (dx > LINK || dx < -LINK) continue;
                const dy = a.y - b.y;
                if (dy > LINK || dy < -LINK) continue;
                const d = Math.hypot(dx, dy);
                if (d > LINK) continue;

                const near = 1 - d / LINK;
                const alpha = 0.28 * near * near;

                cr.newPath();
                cr.moveTo(a.x, a.y);
                cr.lineTo(b.x, b.y);
                cr.setSourceRGBA(R, G, B, alpha);
                cr.stroke();
            }
        }

        for (const p of pts) {
            stamp(cr, this._dot, p.x, p.y, p.size * 2.4);
        }

        cr.restore();
    }
}
