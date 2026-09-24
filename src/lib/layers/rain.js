// A gentle rain seen through the dark: fine streaks falling at a slight slant,
// the far ones short, thin, dim and slow, the near ones longer, brighter and
// faster, and now and then one drop that catches the light.
//
// Every streak leans the same way, so the picture is sheared by the wind until
// they all fall straight down. Then each depth band is a grid of narrow columns
// sliding down, at most one streak to a cell and each kept inside its cell --
// so a pixel looks at one cell per band, however heavy the rain. Every column
// falls at its own speed, with the length, width and brightness that go with
// it, which spreads the depths out within a band and keeps the grid from ever
// moving as one.
//
// A column's scroll is kept exact across the epoch: its speed is a whole number
// of U a second and its period a power of two, so the float arithmetic in
// scroll() loses nothing, and the rain does not skip once every epoch however
// long it has been falling.

const TILT = 0.17;          // the wind: sideways per unit fallen, about 10 degrees
const COLUMN = 32;          // in U, measured across the slant
const PERIOD = 16384;       // in U: how far a column falls before it repeats

// z range, and how many streaks of it a 1080-line screen holds.
const BANDS = [
    [0.0, 0.25, 220],
    [0.25, 0.5, 120],
    [0.5, 0.75, 60],
    [0.75, 1.0, 28],
];

// Everything about a streak follows its depth: length and width in U, speed in
// U a second, and alpha.
const LENGTH = [14, 96];
const SPEED = [250, 630];
const WIDTH = [0.75, 1.25];
const ALPHA = [0.08, 0.24];
const GLINT = 0.03;         // the share of drops that catch the light

// More rain is more of the cells occupied: a quarter as much, up to twice.
export const density = [0.25, 2];

const num = x => x.toFixed(4);
const COS = 1 / Math.hypot(1, TILT);

function band([z0, z1, count], i) {
    // Tall enough for the longest streak of the band with room to place it.
    const longest = (LENGTH[0] + LENGTH[1] * z1) * 1.12;
    const rows = Math.round(PERIOD / (longest * 1.35 + 4));
    const cell = PERIOD / rows;
    const occupied = count * COLUMN * cell / (1920 * 1080);
    return `c += rainBand(xs, ys, ${i}.0, ${num(z0)}, ${num(z1)}, ${rows}.0, ${num(occupied)});`;
}

export const glsl = `
const vec3 RAIN_RGB = vec3(0.745, 0.824, 0.922);

vec4 rainBand(float xs, float ys, float band, float z0, float z1, float rows, float occupied) {
    float col = floor(xs / ${COLUMN}.0);
    vec4 hc = hash42(vec2(col * 1.37 + u_seed * 7.1, band * 31.7 + 5.0));
    float z = mix(z0, z1, hc.x);
    float speed = floor(${num(SPEED[0])} + ${num(SPEED[1])} * z);
    float cell = ${PERIOD}.0 / rows;
    float y = ys - scroll(vec2(0.0, speed), ${PERIOD}.0).y + hc.y * ${PERIOD}.0;
    float row = floor(y / cell);
    vec2 key = vec2(col + u_seed * 3.3, mod(row, rows) + band * 1000.0);
    vec4 h = hash42(key);
    if (h.x > occupied * u_density) return vec4(0.0);

    // Where the streak's head is, and whether this pixel is anywhere near it.
    float len = (${num(LENGTH[0])} + ${num(LENGTH[1])} * z) * (0.88 + 0.24 * h.y);
    float head = row * cell + len + 2.0 + h.z * (cell - len - 4.0);
    float above = head - y;
    float w = ${num(WIDTH[0])} + ${num(WIDTH[1])} * z;
    float wide = max(w * U, 1.0);
    float across = (xs - col * ${COLUMN}.0 - 3.0 - h.w * ${COLUMN - 6}.0) * ${num(COS)} * U;
    if (above > len || above * U < -0.5 * wide - 1.0 || abs(across) > 0.5 * wide + 1.0) return vec4(0.0);

    // Rounded and softened at the head, fading out towards the tail. A streak
    // thinner than a pixel is drawn a pixel wide and fainter instead, so it
    // does not shimmer as it slides across the pixel grid.
    float d = above < 0.0 ? length(vec2(across, above * U / ${num(COS)})) : abs(across);
    float s = clamp(1.0 - above / len, 0.0, 1.0);
    float a = (${num(ALPHA[0])} + ${num(ALPHA[1])} * z) *
              smoothstep(0.0, 0.7, s) * (1.0 - 0.5 * smoothstep(0.88, 1.0, s));

    vec4 k = hash42(key + 19.3);
    vec3 rgb = RAIN_RGB;
    if (k.x > ${num(1 - GLINT)}) {
        a = min(1.0, a * 2.0);
        rgb = mix(rgb, vec3(1.0), 0.5);
    } else {
        a *= 0.7 + 0.3 * k.y;
    }
    return vec4(rgb, 1.0) * a * line(d, wide) * (w * U / wide);
}

vec4 rain(vec2 p) {
    // In U, and sheared by the wind: a streak is a vertical line here.
    float xs = (p.x - p.y * ${num(TILT)}) / U;
    float ys = p.y / U;
    vec4 c = vec4(0.0);
    ${BANDS.map(band).join('\n    ')}
    return c;
}
`;
