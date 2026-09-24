// Large out-of-focus lights, fading in, rising softly and fading out again.
//
// Wide columns this time, two discs to a column, each living its life somewhere
// in the frame and the next one born somewhere else. They used to be born below
// the frame and rarely lived long enough to climb past its lower third; now
// they fill it.

const COLUMN = 160;         // in U
const SLOTS = 2;            // discs per column at any moment, as designed
const MOST = 4;             // and at the most Amount allows

// One disc a column up to four; the last fades in with the setting.
export const density = [1 / SLOTS, MOST / SLOTS];

export const glsl = `
vec3 bokehTint(float i) {
    if (i < 1.0 / 3.0) return vec3(1.0, 0.925, 0.824);
    if (i < 2.0 / 3.0) return vec3(0.804, 0.882, 1.0);
    return vec3(0.922, 0.804, 1.0);
}

vec4 bokehDisc(vec2 p, float column, float slot) {
    vec4 life = hash42(vec2(column * 7.3 + u_seed, slot * 29.1 + 3.0));
    float period = 9.0 + life.x * 9.0;
    vec2 lc = lifecycle(period, life.y);
    float f = lc.y;

    vec4 h = hash42(vec2(column + slot * 0.37 + u_seed, lc.x));
    float size = 24.0 + h.x * h.x * 130.0;
    float speed = 0.008 + (60.0 / size) * 0.012;
    float y = (0.1 + h.z * 1.1 - speed * f * period) * u_canvas.y;
    float r = size * 0.5 * U;
    if (abs(p.y - y) >= r) return vec4(0.0);

    vec4 k = hash42(vec2(lc.x * 0.61 + column, slot + 83.0));
    float sway = (0.01 + k.x * 0.02) * 1920.0 * sin(wphase(0.15 + k.y * 0.35) + k.z * TAU);
    float x = ((column + 0.5) * ${COLUMN}.0 + (h.y - 0.5) * ${(COLUMN * 0.6).toFixed(1)} + sway) * U;

    float e = length(p - vec2(x, y)) / r;
    if (e >= 1.0) return vec4(0.0);
    // A soft body with a brighter rim, as a lens renders a point out of focus.
    float a = e < 0.72 ? mix(0.32, 0.36, e / 0.72)
            : e < 0.9 ? mix(0.36, 0.7, (e - 0.72) / 0.18)
            : mix(0.7, 0.0, (e - 0.9) / 0.1);
    float fade = min(1.0, min(f * 5.0, (1.0 - f) * 5.0));
    return vec4(bokehTint(k.w), 1.0) * a * fade * (0.08 + 0.1 * (1.0 - size / 160.0));
}

vec4 bokeh(vec2 p) {
    vec4 c = vec4(0.0);
    float column = floor(p.x / (${COLUMN}.0 * U));
    // Slot by slot, each behind a test on the Amount setting alone, so every
    // pixel takes the same way and the code stays straight-line.
    for (int dc = -1; dc <= 1; dc++) {
        float col = column + float(dc);
        ${Array.from({ length: MOST }, (_, s) => s < SLOTS
            ? `c += bokehDisc(p, col, ${s}.0)${s === SLOTS - 1 ? ` * clamp(${SLOTS}.0 * u_density - ${s}.0, 0.0, 1.0)` : ''};`
            : `if (${SLOTS}.0 * u_density > ${s}.0) c += bokehDisc(p, col, ${s}.0) * clamp(${SLOTS}.0 * u_density - ${s}.0, 0.0, 1.0);`).join('\n        ')}
    }
    return c;
}
`;
