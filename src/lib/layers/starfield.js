import { seeded } from '../layer.js';

// A deep night sky: stars in depth bands drifting slowly west and twinkling, a
// faint galactic band across it, and now and then a meteor.
//
// The stars are grids of cells like the sparkles, one star to a cell at most.
// The band is a scatter of single dots, one hash per pixel of a 1080-line
// screen against a density that peaks along the band's diagonal. Meteors are
// rare enough to be decided here and handed over as one streak: one to each
// eight-second slot, placed by a hash of the slot, so every monitor of a
// spanned sky agrees on it without having to share anything.

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
const METEOR_EVERY = 8;     // seconds

// More stars are smaller cells: a quarter as many, up to twice.
export const density = [0.25, 2];

function band([z0, z1, share], i) {
    const z = (z0 + z1) / 2;
    const cell = Math.sqrt(1920 * 1080 * OCCUPIED / (COUNT * share));
    // West, in 1080-line pixels a second.
    const drift = -0.0012 * (0.3 + z) * 1920;
    return `c += starBand(p, ${i}.0, ${z0.toFixed(2)}, ${z1.toFixed(2)}, ${cell.toFixed(1)}, ${drift.toFixed(3)});`;
}

export const glsl = `
uniform vec4 starfield_meteor;          // head x, y and tail x, y, in canvas pixels
uniform vec2 starfield_meteor_fade;     // brightness, and whether there is one

vec4 starBand(vec2 p, float band, float z0, float z1, float designCell, float drift) {
    float cell = designCell / sqrt(u_density);
    vec2 q = p / U - scroll(vec2(drift, 0.0), cell * ${REPEAT}.0);
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
    float along = p.x / u_canvas.x;
    float spread = p.y / u_canvas.y - (0.15 + along * 0.55);
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
    constructor({ width, height, unit, seed }) {
        this._width = width;
        this._height = height;
        this._unit = unit;
        this._seed = Math.round(seed * 100);
        this._streak = [0, 0, 0, 0];
    }

    uniforms(t) {
        const m = this._meteor(t);
        if (!m) return [['starfield_meteor_fade', 2, [0, 0]]];

        const across = 1920 * this._unit;
        const fade = Math.sin((m.age / m.life) * Math.PI);
        const x = m.x * this._width + m.vx * m.age * across;
        const y = (m.y + m.vy * m.age) * this._height;
        // Along the way it is actually travelling, in pixels.
        const dx = m.vx * across;
        const dy = m.vy * this._height;
        const len = (90 + 60 * fade) * this._unit / Math.hypot(dx, dy);
        this._streak[0] = x;
        this._streak[1] = y;
        this._streak[2] = x - dx * len;
        this._streak[3] = y - dy * len;
        return [
            ['starfield_meteor', 4, this._streak],
            ['starfield_meteor_fade', 2, [fade, 1]],
        ];
    }

    // The meteor of the slot t falls in, if it is in the sky at t.
    _meteor(t) {
        if (t < 3) return null;
        const slot = Math.floor((t - 3) / METEOR_EVERY);
        const rand = seeded(slot * 7919 + this._seed + 11);
        const life = 0.7 + rand() * 0.5;
        const start = 3 + slot * METEOR_EVERY + rand() * (METEOR_EVERY - life);
        const age = t - start;
        if (age < 0 || age >= life) return null;
        return {
            age,
            life,
            x: 0.1 + rand() * 0.7,
            y: rand() * 0.35,
            vx: 0.55 + rand() * 0.3,
            vy: 0.28 + rand() * 0.2,
        };
    }
}
