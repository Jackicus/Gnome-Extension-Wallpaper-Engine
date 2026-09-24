import { TAU } from '../layer.js';

// Two folded sheets of light with bright crests and glints on their peaks.
//
// The shader evaluates each ribbon's edges exactly at every pixel. What depends
// on time alone is worked out here, once a frame and in double precision: the
// phase of every term, where the curve reaches highest and lowest (which spans
// its gradient), and where its sharpest peaks are (which is where the glints
// sit).

const RIBBONS = [
    { base: 0.62, amp: 54, thick: 110, alpha: 0.15, phase: 0, terms: [[1.05, 1, 0.42], [2.2, 0.36, -0.29], [4.3, 0.1, 0.77]] },
    { base: 0.64, amp: 68, thick: 150, alpha: 0.07, phase: 40, terms: [[0.85, 1, -0.3], [2.7, 0.3, 0.47], [5.1, 0.09, -0.58]] },
];

const GLINTS = 4;           // per ribbon
const STEPS = 240;          // samples across the width when looking for peaks

const num = x => x.toFixed(4);
const vec3 = xs => `vec3(${xs.map(num).join(', ')})`;

const ribbon = (r, i) => `c += waveRibbon(p, wave_bounds.${i ? 'zw' : 'xy'}, ${num(r.base)}, ` +
    `${num(r.amp)}, ${num(r.thick)}, ${num(r.alpha)}, ${vec3(r.terms.map(k => k[0]))}, ` +
    `${vec3(r.terms.map(k => k[1]))}, wave_arg[${i}], wave_wobble[${i}], wave_env[${i}]);`;

export const glsl = `
uniform vec3 wave_arg[2];               // each term's phase, per ribbon
uniform vec3 wave_wobble[2];            // the same for the lower edge's wobble
uniform vec2 wave_env[2];               // the envelope's and the width's phase
uniform vec4 wave_bounds;               // each ribbon's highest and lowest point, in screen heights
uniform vec2 wave_haze;                 // the haze's height and strength
uniform vec4 wave_glint[${GLINTS * 2}];      // x, y in screen fractions; diameter in U; alpha

const vec3 WAVE_RGB = vec3(0.804, 0.894, 1.0);

vec4 waveRibbon(vec2 p, vec2 span, float base, float amp, float thick, float alpha,
                vec3 f, vec3 a, vec3 argT, vec3 wobT, vec2 envT) {
    float W = u_res.x;
    float H = u_res.y;
    float x = p.x / W;

    float ea = x * TAU * 0.5 + envT.x;
    float env = 0.55 + 0.45 * sin(ea);
    vec3 arg = x * f * TAU + argT;
    float y = dot(a, sin(arg));
    float wobble = dot(a, sin(x * f * TAU + wobT));

    float top = H * base + y * amp * U * env;
    float width = thick * U * (0.12 + 0.88 * abs(sin(x * TAU * 0.45 + envT.y)));
    float bottom = top + width + wobble * amp * U * 0.22 * env;

    // The sheet, lit by a gradient spanning the ribbon's whole height.
    float g = clamp((p.y - span.x * H) / max((span.y - span.x) * H, 1.0), 0.0, 1.0);
    float ga = g < 0.3 ? mix(1.3, 1.0, g / 0.3)
             : g < 0.75 ? mix(1.0, 0.45, (g - 0.3) / 0.45)
             : mix(0.45, 0.0, (g - 0.75) / 0.25);
    float lo = min(top, bottom);
    float hi = max(top, bottom);
    float inside = clamp(p.y - lo + 0.5, 0.0, 1.0) * clamp(hi - p.y + 0.5, 0.0, 1.0);
    vec4 c = vec4(WAVE_RGB, 1.0) * alpha * ga * inside;

    // The crest: a wide soft stroke under a fine bright one, at the true
    // distance from the curve rather than the vertical one.
    float slope = amp * U / W * (dot(a * f * TAU, cos(arg)) * env + y * 0.45 * TAU * 0.5 * cos(ea));
    float d = abs(p.y - top) / sqrt(1.0 + slope * slope);
    c += vec4(WAVE_RGB, 1.0) * alpha * 0.55 * line(d, 7.0 * U);
    c += vec4(0.941, 0.973, 1.0, 1.0) * min(1.0, alpha * 2.4) * line(d, 1.2 * U);
    return c;
}

vec4 wave(vec2 p) {
    // Ambient haze breathing beneath the ribbons.
    float hy = (p.y - u_res.y * 0.62) / (wave_haze.x * u_res.y * 0.5);
    vec4 c = vec4(WAVE_RGB, 1.0) * 0.32 * wave_haze.y * max(0.0, 1.0 - abs(hy));

    ${RIBBONS.map(ribbon).join('\n    ')}

    for (int i = 0; i < ${GLINTS * 2}; i++) {
        vec4 g = wave_glint[i];
        if (g.w > 0.0) c += glow(length(p - g.xy * u_res), g.z * 0.5 * U, WAVE_RGB, 0.08) * g.w;
    }
    return c;
}
`;

const wrap = x => x % TAU;

export class State {
    // Side by side, two monitors would otherwise show the same ribbon twice.
    constructor(_w, _h, index) {
        this._offset = index * 37;
        this._top = new Float64Array(STEPS + 1);
        this._arg = [0, 0, 0, 0, 0, 0];
        this._wobble = [0, 0, 0, 0, 0, 0];
        this._env = [0, 0, 0, 0];
        this._bounds = [0, 0, 0, 0];
        this._glints = new Array(GLINTS * 2 * 4).fill(0);
    }

    uniforms(time) {
        const t = time + this._offset;
        this._glints.fill(0);
        RIBBONS.forEach((r, index) => {
            const tt = t + r.phase;
            r.terms.forEach(([, , v], k) => {
                this._arg[index * 3 + k] = wrap(tt * v);
                this._wobble[index * 3 + k] = wrap(tt * v * 0.8 + 1.1);
            });
            this._env[index * 2] = wrap(tt * 0.09 + r.phase * 0.3);
            this._env[index * 2 + 1] = wrap(tt * 0.16 + r.phase);
            this._walk(r, index, tt);
        });
        return [
            ['wave_arg', 3, this._arg],
            ['wave_wobble', 3, this._wobble],
            ['wave_env', 2, this._env],
            ['wave_bounds', 4, this._bounds],
            ['wave_haze', 2, [0.34 + 0.03 * Math.sin(t * 0.11), 0.09 + 0.03 * Math.sin(t * 0.17)]],
            ['wave_glint', 4, this._glints],
        ];
    }

    // The same curve the shader draws, in 1080-line pixels.
    _walk(r, index, t) {
        const top = this._top;
        let minY = Infinity;
        let maxY = -Infinity;

        for (let i = 0; i <= STEPS; i++) {
            const x = i / STEPS;
            const env = 0.55 + 0.45 * Math.sin(x * TAU * 0.5 + t * 0.09 + r.phase * 0.3);
            let y = 0;
            let wobble = 0;
            for (const [f, a, v] of r.terms) {
                y += Math.sin(x * f * TAU + t * v) * a;
                wobble += Math.sin(x * f * TAU + t * v * 0.8 + 1.1) * a;
            }
            const yTop = 1080 * r.base + y * r.amp * env;
            const width = r.thick * (0.12 + 0.88 * Math.abs(Math.sin(x * TAU * 0.45 + t * 0.16 + r.phase)));
            const bottom = yTop + width + wobble * r.amp * 0.22 * env;
            top[i] = yTop;
            minY = Math.min(minY, yTop, bottom);
            maxY = Math.max(maxY, yTop, bottom);
        }
        this._bounds[index * 2] = minY / 1080;
        this._bounds[index * 2 + 1] = maxY / 1080;

        // Glints ride the sharpest peaks of the crest.
        let placed = 0;
        for (let i = 2; i < STEPS - 1 && placed < GLINTS; i++) {
            const y = top[i];
            if (y >= top[i - 1] || y > top[i + 1]) continue;
            const curve = (top[i - 2] + top[i + 2]) / 2 - y;
            if (curve < 0.35) continue;
            const strength = Math.min(1, curve / 3);
            const o = (index * GLINTS + placed) * 4;
            this._glints[o] = i / STEPS;
            this._glints[o + 1] = (y + 3) / 1080;
            this._glints[o + 2] = 44 + strength * 40;
            this._glints[o + 3] = r.alpha * 3.2 * strength;
            placed++;
        }
    }
}
