import { seeded } from '../layer.js';

// A deep night sky: stars in depth bands drifting slowly west and twinkling, a
// faint galactic band across it, and now and then a meteor.
//
// The stars are grids of cells like the sparkles, one star to a cell at most.
// The band is a scatter of single dots, one hash per pixel of a 1080-line
// screen against a density that peaks along the band's diagonal. Meteors are
// rare enough to be decided here and handed over as one streak.

// z range, share of the ~260 stars a 1080-line screen holds.
const BANDS = [
    [0.0, 0.4, 0.4],
    [0.4, 0.7, 0.3],
    [0.7, 0.85, 0.15],
    [0.85, 1.0, 0.15],
];
const COUNT = 260;
const OCCUPIED = 0.8;
const REPEAT = 64;

function band([z0, z1, share], i) {
    const z = (z0 + z1) / 2;
    const cell = Math.sqrt(1920 * 1080 * OCCUPIED / (COUNT * share));
    const drift = -0.0012 * (0.3 + z);
    return `c += starBand(p, ${i}.0, ${z0.toFixed(2)}, ${z1.toFixed(2)}, ${cell.toFixed(1)}, ${drift.toFixed(5)});`;
}

export const glsl = `
uniform vec4 starfield_meteor;          // head x, y and tail x, y, in pixels
uniform vec2 starfield_meteor_fade;     // brightness, and whether there is one

vec4 starBand(vec2 p, float band, float z0, float z1, float cell, float drift) {
    vec2 q = p / U - scroll(vec2(drift * u_res.x / U, 0.0), cell * ${REPEAT}.0);
    vec2 id = mod(floor(q / cell), ${REPEAT}.0);
    vec2 key = id + vec2(band * 53.1 + u_seed, band * 11.3 + 7.0);
    vec4 h = hash42(key);
    if (h.x > ${OCCUPIED.toFixed(2)}) return vec4(0.0);

    float z = mix(z0, z1, h.y);
    float r = 1.1 * (1.4 + z * z * 4.2);
    float margin = r + 2.0;
    vec2 at = floor(q / cell) * cell + margin + h.zw * (cell - 2.0 * margin);
    if (length(q - at) > 1.5 * r) return vec4(0.0);
    vec4 k = hash42(key + 91.7);

    float twinkle = 0.6 + 0.4 * sin(wphase(0.3 + 1.4 * k.x) + k.y * TAU);
    vec3 rgb = z > 0.85 ? vec3(1.0, 0.886, 0.745) : vec3(0.863, 0.91, 1.0);
    return glow(length(q - at) * U, r * U, rgb, 0.2) * (0.25 + 0.7 * z) * twinkle;
}

// ~2600 faint dots on a 1080-line screen, gathered about a line from the upper
// left to the lower right.
vec4 galacticBand(vec2 p) {
    vec2 cell = floor(p / U);
    float along = p.x / u_res.x;
    float spread = p.y / u_res.y - (0.15 + along * 0.55);
    float density = 0.00556 * exp(-spread * spread / 0.0162);
    vec4 h = hash42(cell + vec2(u_seed * 3.1, 17.0));
    if (h.x >= density) return vec4(0.0);
    float a = 0.05 + h.y * 0.18 * (1.0 - min(1.0, abs(spread) * 4.0));
    return vec4(0.824, 0.871, 1.0, 1.0) * a * 0.9;
}

vec4 meteor(vec2 p) {
    vec2 head = starfield_meteor.xy;
    vec2 tail = starfield_meteor.zw;
    float fade = starfield_meteor_fade.x;
    vec2 ab = head - tail;
    float h = clamp(dot(p - tail, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float d = length(p - tail - ab * h);
    vec3 rgb = mix(vec3(0.863, 0.91, 1.0), vec3(1.0), h);
    vec4 c = vec4(rgb, 1.0) * 0.85 * fade * h * line(d, 1.6 * U);
    return c + glow(length(p - head), 7.0 * U, vec3(0.863, 0.91, 1.0), 0.2) * fade;
}

vec4 starfield(vec2 p) {
    vec4 c = galacticBand(p);
    ${BANDS.map(band).join('\n    ')}
    if (starfield_meteor_fade.y > 0.5) c += meteor(p);
    return c;
}
`;

export class State {
    constructor(w, h, index) {
        this._w = w;
        this._h = h;
        this._rand = seeded(11 + index * 101);
        this._meteor = null;
        this._next = 3;
        this._streak = [0, 0, 0, 0];
    }

    uniforms(t) {
        // The clock only runs forwards, but it is a new clock after a reload.
        if (this._meteor && t < this._meteor.start) this._meteor = null;
        if (!this._meteor && t > this._next) {
            const rand = this._rand;
            this._meteor = {
                start: t,
                x: 0.1 + rand() * 0.7,
                y: rand() * 0.35,
                vx: 0.55 + rand() * 0.3,
                vy: 0.28 + rand() * 0.2,
                life: 0.7 + rand() * 0.5,
            };
        }

        const m = this._meteor;
        const age = m ? t - m.start : 0;
        if (!m || age >= m.life) {
            if (m) {
                this._meteor = null;
                this._next = t + 5 + this._rand() * 6;
            }
            return [['starfield_meteor_fade', 2, [0, 0]]];
        }

        const fade = Math.sin((age / m.life) * Math.PI);
        const x = (m.x + m.vx * age) * this._w;
        const y = (m.y + m.vy * age) * this._h;
        // Along the way it is actually travelling, in pixels.
        const dx = m.vx * this._w;
        const dy = m.vy * this._h;
        const len = (90 + 60 * fade) * (this._h / 1080) / Math.hypot(dx, dy);
        this._streak[0] = x;
        this._streak[1] = y;
        this._streak[2] = x - dx * len;
        this._streak[3] = y - dy * len;
        return [
            ['starfield_meteor', 4, this._streak],
            ['starfield_meteor_fade', 2, [fade, 1]],
        ];
    }
}
