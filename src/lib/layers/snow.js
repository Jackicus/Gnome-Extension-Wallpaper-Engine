// A quiet snowfall: flakes drifting down at several depths, the far ones small,
// faint and slow, the near ones larger, out of focus and a little faster, each
// swaying its own way down while a light wind carries the whole fall sideways.
//
// Each depth band is a grid of cells like the sparkles', one flake to a cell at
// most, but taken a column at a time: the band drifts with the wind as one, and
// then every column slides down at a speed of its own, so neighbouring flakes
// never fall in step. A flake keeps clear of its cell's sides by more than its
// sway and its radius, and of the top and bottom by its bob and its radius, so a
// pixel looks at the one cell it is in per band.

// z range, and the share of the flakes a 1080-line screen holds.
const BANDS = [
    [0.00, 0.20, 0.38],
    [0.20, 0.42, 0.27],
    [0.42, 0.64, 0.18],
    [0.64, 0.84, 0.11],
    [0.84, 1.00, 0.06],
];
const COUNT = 300;
// The share of cells with a flake in them at an Amount of 1. More flakes are
// more cells filled, so the grid stays put and a flake fades in or out alone as
// the setting moves, rather than the whole fall being dealt again.
const OCCUPIED = 0.42;
// The grid repeats after this many cells -- far off screen -- so the distance
// it has slid can be kept small.
const REPEAT = 64;

// A quarter as many flakes, up to twice.
export const density = [0.25, 2];

function band([z0, z1, share], i) {
    const cell = Math.sqrt(1920 * 1080 * OCCUPIED / (COUNT * share));
    return `c += snowBand(p, ${i}.0, ${z0.toFixed(2)}, ${z1.toFixed(2)}, ${cell.toFixed(1)});`;
}

export const glsl = `
// Everything about a flake follows from its depth z, 0 the farthest and 1 the
// nearest. Sizes are in U, speeds in U a second.
float snowRadius(float z) { return 0.9 + 3.0 * z + 9.0 * z * z * z * z; }
float snowSoft(float z) { return 0.25 + 0.65 * z * z; }  // blurred edge, a share of the radius
float snowAlpha(float z) { return 0.3 + 0.5 * smoothstep(0.0, 0.6, z) - 0.35 * smoothstep(0.7, 1.0, z); }
float snowFall(float z) { return 22.0 + 34.0 * z; }
float snowWind(float z) { return 4.0 + 12.0 * z; }
float snowSway(float z) { return 4.0 + 18.0 * z; }
float snowReach(float z) { return snowRadius(z) * (1.0 + snowSoft(z)) + 2.0; }

// A soft disc: d and r in pixels. Its edge is never sharper than a pixel and a
// half, and a disc smaller than that is widened and dimmed to match, so a far
// flake glides across the pixel grid instead of twinkling: its brightness summed
// over the pixels it covers stays within a few percent wherever it sits.
float snowDisc(float d, float r, float soft) {
    float rr = max(r, 0.8);
    float w = max(rr * soft, 0.75);
    return (r * r) / (rr * rr) * (1.0 - smoothstep(rr - w, rr + w, d));
}

vec4 snowBand(vec2 p, float band, float z0, float z1, float cell) {
    float z = 0.5 * (z0 + z1);
    float period = cell * ${REPEAT}.0;

    // The band drifts with the wind, which rises and falls a little.
    float gust = (8.0 + 40.0 * z) * sin(wphase(0.11) + band * 0.4);
    float qx = p.x / U - scroll(vec2(snowWind(z), 0.0), period).x - gust;
    float col = floor(qx / cell);
    float cid = mod(col, ${REPEAT}.0);

    // Then each column falls at its own pace.
    float pace = 0.82 + 0.36 * hash12(vec2(cid + u_seed * 3.7, band * 17.3 + 5.0));
    float qy = p.y / U - scroll(vec2(0.0, snowFall(z) * pace), period).y;
    float row = floor(qy / cell);

    vec2 key = vec2(cid, mod(row, ${REPEAT}.0)) + vec2(band * 71.3 + u_seed, band * 19.7);
    vec4 h = hash42(key);
    float filled = ${OCCUPIED.toFixed(2)} * u_density;
    if (h.x > filled) return vec4(0.0);

    // Nothing to draw this far from where the flake's sway can take it.
    float reach = snowReach(z1);
    vec2 margin = vec2(snowSway(z1) + reach, 0.25 * snowSway(z1) + reach);
    vec2 at = vec2(col, row) * cell + margin + h.zw * (cell - 2.0 * margin);
    vec2 off = vec2(qx, qy) - at;
    if (abs(off.x) > margin.x || abs(off.y) > margin.y) return vec4(0.0);

    // Swinging from side to side like a falling leaf, lifting a little at
    // either end of the swing, with a slower second sway so no two repeat.
    vec4 k = hash42(key + 37.1);
    float f = mix(z0, z1, h.y);
    float swing = wphase(0.5 + 0.6 * k.x) + k.y * TAU;
    float sway = snowSway(f);
    off.x -= sway * (0.75 * sin(swing) + 0.25 * sin(wphase(0.17 + 0.2 * k.z) + k.w * TAU));
    off.y += 0.25 * sway * cos(2.0 * swing);

    float r = snowRadius(f);
    float a = snowDisc(length(off) * U, r * U, snowSoft(f));
    // Fading in and out with the Amount setting rather than popping.
    a *= clamp((filled - h.x) / (0.08 * filled), 0.0, 1.0);
    return vec4(0.922, 0.949, 1.0, 1.0) * a * snowAlpha(f);
}

vec4 snow(vec2 p) {
    vec4 c = vec4(0.0);
    ${BANDS.map(band).join('\n    ')}
    return c;
}
`;
