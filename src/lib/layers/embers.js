// Sparks rising from a warm glow along the bottom edge, cooling from white
// through orange to red as they climb and fade.
//
// The screen is cut into narrow columns, each running a few sparks one after
// another: a spark is born just below the bottom edge, rises and dies, and the
// next takes its place somewhere else in the column. Everything about a spark
// is a function of its column, its slot and which life it is on, so nothing is
// kept between frames, and a pixel looks at three columns' worth of sparks.

const COLUMN = 52;          // in U: ~37 columns across a 1920-wide screen
const SLOTS = 3;            // sparks per column at any moment

export const glsl = `
vec4 emberSpark(vec2 p, float column, float slot) {
    vec4 life = hash42(vec2(column + u_seed * 5.3, slot * 13.7));
    float period = 4.0 + life.x * 5.0;
    vec2 lc = lifecycle(period, life.y);
    float f = lc.y;

    vec4 h = hash42(vec2(column * 3.1 + slot + u_seed, lc.x));
    float rise = 0.035 + h.y * 0.07;
    float size = 2.0 + h.z * h.z * 5.0;
    float r = size * (1.2 - 0.5 * f) * U;

    // Slowing as it cools; born just below the bottom edge. Where it is, and
    // whether it is anywhere near, is settled before anything else is worked out.
    float y = (1.02 + h.w * 0.06 - rise * period * (1.3 * f - 0.3 * f * f)) * u_res.y;
    float x = ((column + 0.5) * ${COLUMN}.0 + (h.x - 0.5) * ${COLUMN / 2}.0) * U;
    if (abs(p.y - y) > 1.2 * r || abs(p.x - x) > 1.2 * r + 14.0 * U) return vec4(0.0);

    vec4 k = hash42(vec2(lc.x * 1.7 + slot, column + 41.0));
    x += 14.0 * U * (vnoise(vec2(k.x * 40.0, (lc.x + f) * 1.5)) - 0.5) * 2.0;

    float flicker = 0.7 + 0.3 * sin(wphase(6.0 + k.y * 10.0) + k.z * TAU);
    float alpha = pow(1.0 - f, 0.7) * flicker * 0.9;
    vec3 rgb = mix(vec3(1.0, 0.941, 0.784), vec3(1.0, 0.627, 0.235), smoothstep(0.2, 0.4, f));
    rgb = mix(rgb, vec3(1.0, 0.353, 0.118), smoothstep(0.6, 0.8, f));
    return glow(length(p - vec2(x, y)), r, rgb, 0.25) * alpha;
}

vec4 embers(vec2 p) {
    // The fire below the frame.
    float heat = 0.5 + 0.15 * sin(wphase(0.7)) + 0.08 * sin(wphase(2.3));
    float band = (p.y - u_res.y * 0.72) / (u_res.y * 0.28);
    vec4 c = vec4(1.0, 0.471, 0.157, 1.0) * 0.28 * clamp(band, 0.0, 1.0) * heat;

    float column = floor(p.x / (${COLUMN}.0 * U));
    for (int dc = -1; dc <= 1; dc++)
        for (int s = 0; s < ${SLOTS}; s++)
            c += emberSpark(p, column + float(dc), float(s));
    return c;
}
`;
