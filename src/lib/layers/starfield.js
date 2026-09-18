import cairo from 'cairo';
import { TAU, countFor, glowSprite, seeded, stampWithAlpha } from '../layer.js';

export class StarfieldLayer {
    constructor() {
        this._glow = glowSprite(32, 220 / 255, 232 / 255, 255 / 255, 0.2);
        this._warm = glowSprite(32, 255 / 255, 226 / 255, 190 / 255, 0.2);
        this._stars = [];
        this._band = null;
        this._meteor = null;
        this._nextMeteor = 3;
    }

    resize(w, h) {
        const rand = seeded(11);
        this._stars = Array.from({ length: countFor(w, h, 260, 60) }, () => {
            const z = rand();
            return {
                x: rand(),
                y: rand(),
                z,
                size: 1.4 + z * z * 4.2,
                tw: rand() * TAU,
                tws: 0.3 + rand() * 1.4,
            };
        });

        // The galactic band: diagonal drift of faint points painted once
        const band = new cairo.ImageSurface(cairo.Format.ARGB32, w, h);
        const cr = new cairo.Context(band);
        const count = countFor(w, h, 2600, 400);

        for (let i = 0; i < count; i++) {
            const along = rand();
            const spread = (rand() + rand() + rand() - 1.5) * 0.18;
            const x = along * w;
            const y = (0.15 + along * 0.55 + spread) * h;
            const a = 0.05 + rand() * 0.18 * (1 - Math.min(1, Math.abs(spread) * 4));
            cr.setSourceRGBA(210 / 255, 222 / 255, 255 / 255, a);
            cr.rectangle(x, y, 1, 1);
            cr.fill();
        }
        this._band = band;
    }

    draw(cr, s) {
        cr.save();

        if (this._band) {
            cr.setSourceSurface(this._band, 0, 0);
            cr.paintWithAlpha(0.9);
        }

        cr.setOperator(cairo.Operator.ADD);

        for (const st of this._stars) {
            const x = (((st.x - s.t * 0.0012 * (0.3 + st.z)) % 1) + 1) % 1;
            const twinkle = 0.6 + 0.4 * Math.sin(s.t * st.tws + st.tw);
            const alpha = (0.25 + 0.7 * st.z) * twinkle;
            const sprite = st.z > 0.85 ? this._warm : this._glow;
            stampWithAlpha(cr, sprite, x * s.w, st.y * s.h, st.size * 2.2, alpha);
        }

        // Shooting star / meteor
        if (!this._meteor && s.t > this._nextMeteor) {
            const rand = Math.random;
            this._meteor = {
                x: 0.1 + rand() * 0.7,
                y: rand() * 0.35,
                vx: 0.55 + rand() * 0.3,
                vy: 0.28 + rand() * 0.2,
                life: 0.7 + rand() * 0.5,
                age: 0,
            };
        }

        const m = this._meteor;
        if (m) {
            m.age += s.dt;
            const f = m.age / m.life;
            if (f >= 1) {
                this._meteor = null;
                this._nextMeteor = s.t + 5 + Math.random() * 6;
            } else {
                const fade = Math.sin(f * Math.PI);
                const x = (m.x + m.vx * m.age) * s.w;
                const y = (m.y + m.vy * m.age) * s.h;
                const len = 90 + 60 * fade;
                const dist = Math.hypot(m.vx, m.vy);
                const nx = m.vx / dist;
                const ny = m.vy / dist;

                const grad = new cairo.LinearGradient(x - nx * len, y - ny * len, x, y);
                grad.addColorStopRGBA(0, 220 / 255, 232 / 255, 255 / 255, 0);
                grad.addColorStopRGBA(1, 1, 1, 1, 0.85 * fade);

                cr.newPath();
                cr.moveTo(x - nx * len, y - ny * len);
                cr.lineTo(x, y);
                cr.setLineCap(cairo.LineCap.ROUND);
                cr.setLineWidth(1.6);
                cr.setSource(grad);
                cr.stroke();

                stampWithAlpha(cr, this._glow, x, y, 14, fade);
            }
        }

        cr.restore();
    }
}
