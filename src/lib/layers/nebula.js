import { TAU, seeded } from '../layer.js';

const CLOUDS = 14;          // a screen's width of sky holds this many, as designed
const PER_HUE = 16;         // glows of one colour a monitor can be handed

const HUES = [
    [140, 90, 255],
    [50, 200, 220],
    [230, 80, 180],
    [60, 120, 255],
];

// More or fewer clouds, from a sparse few to a crowded sky.
export const density = [0.25, 1.5];

const rgb = ([r, g, b]) => `vec3(${[r, g, b].map(v => (v / 255).toFixed(4)).join(', ')})`;
const LANES = ['x', 'y', 'z', 'w'];

// Slow clouds, each three overlapping glows: violet, teal, magenta and blue
// light turning over each other. Where the clouds are is worked out here, once
// a frame -- a few sines each -- and each monitor is handed only the glows that
// reach it. A cloud's colour is fixed, so the glows come in one list per colour
// and are summed as four strengths, the colours applied once at the end.
export const glsl = `
uniform vec4 nebula_count;                              // live glows of each colour
${HUES.map((_, h) => `uniform vec4 nebula_glow${h}[${PER_HUE}];`).join('\n')}   // centre, 1 / radius, strength

// The falloff the clouds always had: a soft core and a long tail.
float nebulaGlow(vec2 p, vec4 g) {
    vec2 d = (p - g.xy) * g.z;
    float x = sqrt(dot(d, d));
    return g.w * (x < 0.45 ? mix(0.9, 0.28, x / 0.45) : max(0.0, 0.28 * (1.0 - x) / 0.55));
}

// Written out four glows at a time, each four behind a test of the count: the
// tests are on uniforms, so every pixel takes the same way through them and the
// code stays straight-line. A loop that stopped at a count ran 40% slower, and
// testing every glow 15%.
vec4 nebula(vec2 p) {
    vec4 a = vec4(0.0);
    ${HUES.flatMap((_, h) => Array.from({ length: PER_HUE / 4 }, (_, b) =>
        `if (nebula_count.${LANES[h]} > ${b * 4}.5) a.${LANES[h]} += ` +
        [0, 1, 2, 3].map(k => `nebulaGlow(p, nebula_glow${h}[${b * 4 + k}])`).join(' + ') + ';')).join('\n    ')}
    return vec4(${HUES.map((h, i) => `${rgb(h)} * a.${LANES[i]}`).join(' + ')}, a.x + a.y + a.z + a.w);
}
`;

export class State {
    constructor({ width, height, unit, seed, rect }) {
        this._width = width;
        this._height = height;
        this._unit = unit;
        this._rect = rect;
        this._widths = width / (1920 * unit);
        this._lanes = HUES.map(() => new Array(PER_HUE * 4).fill(0));

        // Enough for the most the Amount setting can ask of a canvas this wide;
        // the first fourteen of a screen are the layout the clouds always had.
        const rand = seeded(41 + seed * 57.8);
        const most = Math.ceil(CLOUDS * this._widths * density[1]);
        this._clouds = Array.from({ length: most }, (_, i) => ({
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

    uniforms(t, amount) {
        const { x: left, y: top, width, height } = this._rect;
        const across = 1920 * this._unit;
        const unit = Math.min(this._width, this._height);
        const count = Math.max(1, Math.round(CLOUDS * this._widths * amount));
        const counts = [0, 0, 0, 0];
        // The shader reads glows four at a time, so the ones past a count must
        // be nothing rather than whatever an earlier frame left there.
        for (const lane of this._lanes) lane.fill(0);

        // Only the glows whose reach touches this monitor.
        const put = (hue, x, y, diameter, strength) => {
            const r = diameter / 2;
            if (x + r < left || x - r > left + width || y + r < top || y - r > top + height) return;
            if (counts[hue] === PER_HUE) return;
            const lane = this._lanes[hue];
            const o = counts[hue]++ * 4;
            lane[o] = x;
            lane[o + 1] = y;
            lane[o + 2] = 1 / r;
            lane[o + 3] = strength;
        };

        for (const c of this._clouds.slice(0, count)) {
            const x = c.cx * this._width + Math.sin(t * c.fx + c.px) * c.ax * across;
            const y = (c.cy + Math.sin(t * c.fy + c.py) * c.ay) * this._height;
            const size = c.size * unit * (0.92 + 0.08 * Math.sin(t * 0.2 + c.pulse));
            put(c.hue, x, y, size, 0.144);
            put(c.hue, x + c.lobes[0] * size * 0.7, y + c.lobes[1] * size * 0.7, size * 0.75, 0.099);
            put(c.hue, x + c.lobes[2] * size * 0.7, y + c.lobes[3] * size * 0.7, size * 0.6, 0.099);
        }

        return [
            ['nebula_count', 4, counts],
            ...this._lanes.map((lane, h) => [`nebula_glow${h}`, 4, lane]),
        ];
    }
}
