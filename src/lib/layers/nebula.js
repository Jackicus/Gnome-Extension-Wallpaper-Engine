import { TAU, seeded } from '../layer.js';

const CLOUDS = 14;

const HUES = [
    [140, 90, 255],
    [50, 200, 220],
    [230, 80, 180],
    [60, 120, 255],
];

const rgb = ([r, g, b]) => `vec3(${[r, g, b].map(v => (v / 255).toFixed(4)).join(', ')})`;
const LANES = ['x', 'y', 'z', 'w'];

// Fourteen slow clouds, each three overlapping glows: violet, teal, magenta and
// blue light turning over each other. Where the clouds are is worked out here,
// once a frame -- fourteen sines -- and the shader only has to add them up.
// Each cloud's colour is fixed, so the glows are summed as four strengths, one
// per colour, and the colours applied once at the end.
export const glsl = `
uniform vec4 nebula_glow[${CLOUDS * 3}];       // centre, 1 / radius, unused

// The falloff the clouds always had: a soft core and a long tail.
float nebulaGlow(vec2 p, vec4 g) {
    vec2 d = (p - g.xy) * g.z;
    float x = sqrt(dot(d, d));
    return x < 0.45 ? mix(0.9, 0.28, x / 0.45) : max(0.0, 0.28 * (1.0 - x) / 0.55);
}

vec4 nebula(vec2 p) {
    vec4 a = vec4(0.0);
    ${Array.from({ length: CLOUDS * 3 }, (_, i) =>
        `a.${LANES[Math.floor(i / 3) % 4]} += nebulaGlow(p, nebula_glow[${i}]) * ${i % 3 ? '0.099' : '0.144'};`).join('\n    ')}
    return vec4(${HUES.map((h, i) => `${rgb(h)} * a.${LANES[i]}`).join(' + ')}, a.x + a.y + a.z + a.w);
}
`;

export class State {
    constructor(w, h, index) {
        this._w = w;
        this._h = h;
        this._glows = new Array(CLOUDS * 3 * 4).fill(0);

        const rand = seeded(41 + index * 1000);
        this._clouds = Array.from({ length: CLOUDS }, () => ({
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
            lobes: [rand() - 0.5, rand() - 0.5, rand() - 0.5, rand() - 0.5],
        }));
    }

    uniforms(t) {
        const g = this._glows;
        const unit = Math.min(this._w, this._h);
        let o = 0;
        const put = (x, y, diameter) => {
            g[o++] = x;
            g[o++] = y;
            g[o++] = 2 / diameter;
            g[o++] = 0;
        };

        for (const c of this._clouds) {
            const x = (c.cx + Math.sin(t * c.fx + c.px) * c.ax) * this._w;
            const y = (c.cy + Math.sin(t * c.fy + c.py) * c.ay) * this._h;
            const size = c.size * unit * (0.92 + 0.08 * Math.sin(t * 0.2 + c.pulse));
            put(x, y, size);
            put(x + c.lobes[0] * size * 0.7, y + c.lobes[1] * size * 0.7, size * 0.75);
            put(x + c.lobes[2] * size * 0.7, y + c.lobes[3] * size * 0.7, size * 0.6);
        }
        return [['nebula_glow', 4, g]];
    }
}
