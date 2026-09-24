// Green and violet curtains of polar light, hanging and rippling across the
// sky, streaked with rays.
//
// Each curtain is one line of noise along the width: where it hangs, how long
// it is, how bright each ray. A pixel only has to ask that of its own column,
// and shade the curtain's vertical gradient at its height.

const CURTAINS = [
    { rgb: [150, 110, 255], hang: 0.34, wander: 0.14, minLen: 0.16, maxLen: 0.5, alpha: 0.55, drift: 0.018, seed: 31 },
    { rgb: [70, 235, 160], hang: 0.42, wander: 0.1, minLen: 0.1, maxLen: 0.36, alpha: 0.85, drift: 0.03, seed: 17 },
];

const num = x => x.toFixed(4);

const curtain = c => `c += auroraCurtain(p, vec3(${c.rgb.map(v => num(v / 255)).join(', ')}), ` +
    `${num(c.hang)}, ${num(c.wander)}, ${num(c.minLen)}, ${num(c.maxLen)}, ${num(c.alpha)}, ` +
    `${num(c.drift)}, ${c.seed}.0);`;

export const glsl = `
vec4 auroraCurtain(vec2 p, vec3 rgb, float hang, float wander, float minLen, float maxLen,
                   float alpha, float pace, float seed) {
    // Rows no curtain of this height and sway can reach cost nothing.
    float row = p.y / u_canvas.y;
    if (row > hang + wander + 0.01 || row < hang - wander - maxLen) return vec4(0.0);

    vec2 o = vec2(seed * 7.31 + u_seed, seed * 3.17);
    float u = p.x / DESIGN_W;

    float sag = fbm(vec2(u * 1.6 + drift(pace), 3.3 + drift(0.02)) + o) - 0.5;
    float bottom = (hang + sag * 2.0 * wander) * u_canvas.y;
    if (p.y > bottom + 5.0 * U) return vec4(0.0);

    float len = fbm(vec2(u * 2.4 - drift(pace * 1.3), 9.0 + drift(0.05)) + o);
    float height = (minLen + (maxLen - minLen) * len) * u_canvas.y;
    float g = (p.y - (bottom - height)) / height;
    if (g < 0.0) return vec4(0.0);
    // Two scales of ray, so the curtain breaks into streaks of every width
    // rather than bands of one.
    float rays = vnoise(vec2(u * 38.0 + drift(0.12), 20.0 + drift(0.35)) + o) * 0.6 +
                 vnoise(vec2(u * 103.0 - drift(0.2), 50.0 + drift(0.6)) + o) * 0.4;

    // Faint at the top, brightest just above the hem, and a soft hem under it.
    float a = g < 0.5 ? mix(0.0, 0.22, g / 0.5)
            : g < 0.9 ? mix(0.22, 0.9, (g - 0.5) / 0.4)
            : g < 1.0 ? mix(0.9, 0.15, (g - 0.9) / 0.1)
            : 0.15 * max(0.0, 1.0 - (p.y - bottom) / (5.0 * U));
    float breathe = 0.75 + 0.25 * sin(wphase(0.13));
    return vec4(rgb, 1.0) * a * alpha * breathe * (0.3 + 0.7 * rays) * 0.85;
}

vec4 aurora(vec2 p) {
    vec4 c = vec4(0.0);
    ${CURTAINS.map(curtain).join('\n    ')}
    return c;
}
`;
