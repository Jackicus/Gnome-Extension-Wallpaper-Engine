import cairo from 'cairo';
import { TAU, glowSprite, stampWithAlpha } from '../layer.js';

const R = 205 / 255;
const G = 228 / 255;
const B = 255 / 255;

const RIBBONS = [
    { base: 0.62, amp: 54, thick: 110, alpha: 0.15, phase: 0, terms: [[1.05, 1, 0.42], [2.2, 0.36, -0.29], [4.3, 0.1, 0.77]] },
    { base: 0.64, amp: 68, thick: 150, alpha: 0.07, phase: 40, terms: [[0.85, 1, -0.3], [2.7, 0.3, 0.47], [5.1, 0.09, -0.58]] },
];

export class WaveLayer {
    constructor() {
        this._glint = glowSprite(64, R, G, B, 0.08);

        // One vertical gradient, painted once and stretched across width
        this._haze = new cairo.ImageSurface(cairo.Format.ARGB32, 1, 256);
        const cr = new cairo.Context(this._haze);
        const grad = new cairo.LinearGradient(0, 0, 0, 256);
        grad.addColorStopRGBA(0, R, G, B, 0);
        grad.addColorStopRGBA(0.5, R, G, B, 0.32);
        grad.addColorStopRGBA(1, R, G, B, 0);
        cr.setSource(grad);
        cr.paint();

        this._top = new Float32Array(0);
        this._bottom = new Float32Array(0);
    }

    resize(w, h) {
        const steps = Math.max(120, Math.min(260, Math.round(w / 8)));
        if (this._top.length !== steps + 1) {
            this._top = new Float32Array(steps + 1);
            this._bottom = new Float32Array(steps + 1);
        }
    }

    draw(cr, s) {
        const steps = Math.max(120, Math.min(260, Math.round(s.w / 8)));
        if (this._top.length !== steps + 1) {
            this._top = new Float32Array(steps + 1);
            this._bottom = new Float32Array(steps + 1);
        }

        cr.save();
        cr.setOperator(cairo.Operator.ADD);

        // Ambient haze breathing beneath ribbons
        const hazeH = s.h * 0.34 + Math.sin(s.t * 0.11) * s.h * 0.03;
        const hazeAlpha = 0.09 + 0.03 * Math.sin(s.t * 0.17);
        const hazeY = s.h * 0.62 - hazeH / 2;

        cr.save();
        cr.translate(0, hazeY);
        cr.scale(s.w, hazeH / 256);
        cr.setSourceSurface(this._haze, 0, 0);
        cr.paintWithAlpha(hazeAlpha);
        cr.restore();

        for (const r of RIBBONS) {
            this._drawRibbon(cr, s, r, steps);
        }

        cr.restore();
    }

    _drawRibbon(cr, s, r, steps) {
        const t = s.t + r.phase;
        const baseY = s.h * r.base;
        let minY = Infinity;
        let maxY = -Infinity;

        for (let i = 0; i <= steps; i++) {
            const p = i / steps;
            const env = 0.55 + 0.45 * Math.sin(p * TAU * 0.5 + t * 0.09 + r.phase * 0.3);
            let y = 0;
            for (const [f, a, v] of r.terms) {
                y += Math.sin(p * f * TAU + t * v) * a;
            }
            const top = baseY + y * r.amp * env;
            const width = r.thick * (0.12 + 0.88 * Math.abs(Math.sin(p * TAU * 0.45 + t * 0.16 + r.phase)));
            let wobble = 0;
            for (const [f, a, v] of r.terms) {
                wobble += Math.sin(p * f * TAU + t * v * 0.8 + 1.1) * a;
            }
            const bottom = top + width + wobble * r.amp * 0.22 * env;
            this._top[i] = top;
            this._bottom[i] = bottom;
            if (top < minY) minY = top;
            if (bottom > maxY) maxY = bottom;
        }

        // The sheet polygon
        cr.newPath();
        for (let i = 0; i <= steps; i++) {
            const x = (i / steps) * s.w;
            if (i === 0) cr.moveTo(x, this._top[i]);
            else cr.lineTo(x, this._top[i]);
        }
        for (let i = steps; i >= 0; i--) {
            cr.lineTo((i / steps) * s.w, this._bottom[i]);
        }
        cr.closePath();

        const grad = new cairo.LinearGradient(0, minY, 0, maxY);
        grad.addColorStopRGBA(0, R, G, B, r.alpha * 1.3);
        grad.addColorStopRGBA(0.3, R, G, B, r.alpha);
        grad.addColorStopRGBA(0.75, R, G, B, r.alpha * 0.45);
        grad.addColorStopRGBA(1, R, G, B, 0);
        cr.setSource(grad);
        cr.fill();

        // The crest strokes: soft wide stroke, sharp bright one over it
        cr.newPath();
        for (let i = 0; i <= steps; i++) {
            const x = (i / steps) * s.w;
            if (i === 0) cr.moveTo(x, this._top[i]);
            else cr.lineTo(x, this._top[i]);
        }
        cr.setLineJoin(cairo.LineJoin.ROUND);
        cr.setSourceRGBA(R, G, B, r.alpha * 0.55);
        cr.setLineWidth(7);
        cr.strokePreserve();

        cr.setSourceRGBA(240 / 255, 248 / 255, 255 / 255, r.alpha * 2.4);
        cr.setLineWidth(1.2);
        cr.stroke();

        // Glints: placed on crest peaks
        let placed = 0;
        for (let i = 2; i < steps - 1 && placed < 4; i++) {
            const y = this._top[i];
            if (y >= this._top[i - 1] || y > this._top[i + 1]) continue;
            const curve = (this._top[i - 2] + this._top[i + 2]) / 2 - y;
            if (curve < 0.35) continue;
            const strength = Math.min(1, curve / 3);
            const alpha = r.alpha * 3.2 * strength;
            stampWithAlpha(cr, this._glint, (i / steps) * s.w, y + 3, 44 + strength * 40, alpha);
            placed++;
        }
    }
}
