// Drifting specks of light, nearer ones larger, brighter and faster.
//
// Depth comes in four bands, each a grid of cells sliding at its own pace with
// at most one speck in a cell -- so a pixel only ever looks at the one cell it is
// in per band, however many specks there are. A speck keeps clear of its cell's
// edges by more than its glow and its sway, which is what makes one cell enough.

// z range, and the share of the ~90 specks a 1080-line screen holds.
const BANDS = [
    [0.0, 0.1, 0.33],
    [0.1, 0.3, 0.33],
    [0.3, 0.6, 0.245],
    [0.6, 1.0, 0.095],
];
const COUNT = 90;
const OCCUPIED = 0.75;
// The grid repeats after this many cells -- far off screen -- so the distance
// it has slid can be kept small.
const REPEAT = 64;

// More specks are smaller cells: down to a quarter as many, up to twice.
export const density = [0.25, 2];

function band([z0, z1, share], i) {
    const z = (z0 + z1) / 2;
    const cell = Math.sqrt(1920 * 1080 * OCCUPIED / (COUNT * share));
    // In 1080-line pixels a second, up and to the right.
    const vx = (0.006 + 0.02 * z) * 1920;
    const vy = -(0.003 + 0.012 * z) * 1080;
    return `c += sparkleBand(p, ${i}.0, ${z0.toFixed(2)}, ${z1.toFixed(2)}, ${cell.toFixed(1)}, ` +
        `vec2(${vx.toFixed(2)}, ${vy.toFixed(2)}));`;
}

export const glsl = `
vec4 sparkleBand(vec2 p, float band, float z0, float z1, float designCell, vec2 drift) {
    float cell = designCell / sqrt(u_density);
    vec2 q = p / U - scroll(drift, cell * ${REPEAT}.0);
    vec2 id = mod(floor(q / cell), ${REPEAT}.0);
    vec2 key = id + vec2(band * 71.3 + u_seed, band * 19.7);
    vec4 h = hash42(key);
    if (h.x > ${OCCUPIED.toFixed(2)}) return vec4(0.0);

    // Nothing to draw this far from where the speck's sway can take it.
    float margin = 5.5 + 12.0 + 2.0;
    vec2 at = floor(q / cell) * cell + margin + h.zw * (cell - 2.0 * margin);
    vec2 off = q - at;
    if (abs(off.y) > 6.0 || abs(off.x) > 18.0) return vec4(0.0);

    vec4 k = hash42(key + 37.1);
    float z = mix(z0, z1, h.y);
    off.x -= 12.0 * sin(wphase(0.2 + 0.5 * k.x) + k.y * TAU);
    return glow(length(off) * U, (1.5 + 4.0 * z) * U, vec3(0.882, 0.933, 1.0), 0.12) * (0.22 + 0.5 * z);
}

vec4 sparkles(vec2 p) {
    vec4 c = vec4(0.0);
    ${BANDS.map(band).join('\n    ')}
    return c;
}
`;
