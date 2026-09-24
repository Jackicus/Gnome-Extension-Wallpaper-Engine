// Fireflies on a summer night: small yellow-green lights wandering slowly
// along curving paths, each glowing up, peaking briefly and fading on its own
// rhythm before a longer rest in the dark, so only some are lit at any moment.
// They keep mostly to the lower two thirds of the frame.
//
// One firefly to a cell at most, in a grid that stays put. Each has a home near
// its cell's centre and wanders from it along a few slow sines, but never
// further than a pixel will look for it: a cell and a half across and one cell
// up or down, less the reach of its light. So a pixel looks at the three
// columns and two rows of cells nearest it, and the paths still overlap their
// neighbours' freely. The cells are taller than they are wide so that each
// firefly's height ranges over more than its own row -- otherwise, over a
// minute, the lights settle into horizontal bands.
//
// Six cells a pixel is the cost: the GPU runs nearly all of a cell's code
// whether or not that cell's firefly is there or lit, so what matters is how
// much code a cell has, not how early it can give up. That is why one hash is
// spread four ways rather than calling hash42.

// Fireflies on a 1080-line screen at Amount 1, and the chance that a cell low
// in the frame has one. Above RISE of the way down, the chance thins to TOP of
// that at the top edge, which leaves about one in eight of the lights in the
// top third of the frame.
const COUNT = 53;
const OCCUPIED = 0.56;
const TOP = 0.06;
const RISE = 0.62;
const smoothstep = x => (x = Math.min(1, Math.max(0, x))) * x * (3 - 2 * x);
let WEIGHT = 0;
for (let i = 0; i < 100; i++) WEIGHT += (TOP + (1 - TOP) * smoothstep((i + 0.5) / 100 / RISE)) / 100;
const AREA = 1920 * 1080 * OCCUPIED * WEIGHT / COUNT;
const CELL_W = Math.sqrt(AREA) * 0.83;
const CELL_H = Math.sqrt(AREA) / 0.83;

// In U: how far a home sits from its cell's centre, how far a firefly wanders
// from its home, how far it climbs during one flash, and how far its light
// reaches.
const HOME_X = 20;
const HOME_Y = 34;
const WANDER_X = 98;
const WANDER_Y = 68;
const CLIMB = 10;
const REACH = 36;
if (HOME_X + WANDER_X + REACH > 1.5 * CELL_W || HOME_Y + WANDER_Y + CLIMB + REACH > CELL_H)
    throw new Error('fireflies: a firefly can wander out of reach of the cells a pixel looks at');

// More fireflies means more cells occupied: from a quarter as many up to about
// twice as many (the densest rows fill up first).
export const density = [0.25, 2];

const f = x => x.toFixed(2);

export const glsl = `
vec4 firefliesLight(vec2 q, vec2 cell, float share) {
    vec2 key = cell + vec2(u_seed * 7.31 + 3.7, 11.9);
    float here = (share - hash12(key)) * 30.0;
    if (here <= 0.0) return vec4(0.0);

    // A flash of 1.5-2.5 s, then a rest in the dark of one to two and a half
    // times as long.
    vec4 h = fract(hash12(key + 17.7) * vec4(1.0, 37.13, 91.71, 213.37));
    float flash = 1.5 + h.w;
    float cycle = 2.0 + 1.5 * h.y;
    vec2 lc = lifecycle(flash * cycle, h.z);
    float s = lc.y * cycle;
    if (s >= 1.0) return vec4(0.0);

    // Two slow sines on each axis, one pair of them shared as a loop: a path
    // that curves and never quite repeats. It climbs a little during a flash
    // and drops back while dark, where no one can see it happen.
    vec4 k = fract(h.yzwx * vec4(13.7, 17.3, 11.9, 19.1) + h.zwxy);
    vec2 at = (cell + 0.5) * vec2(${f(CELL_W)}, ${f(CELL_H)}) +
        (k.xy - 0.5) * vec2(${f(2 * HOME_X)}, ${f(2 * HOME_Y)});
    float loop = wphase(0.3 + 0.2 * k.z) + k.w * TAU;
    at += vec2(${f(WANDER_X * 0.62)} * sin(wphase(0.1 + 0.07 * k.x) + k.y * TAU) + ${f(WANDER_X * 0.38)} * sin(loop),
               ${f(WANDER_Y * 0.62)} * sin(wphase(0.13 + 0.08 * k.y) + k.x * TAU) + ${f(WANDER_Y * 0.38)} * cos(loop) -
               ${f(CLIMB)} * s);
    vec2 off = q - at;
    float d2 = dot(off, off);
    float z = fract(h.x * 23.3 + h.y * 5.1);
    float reach = ${f(REACH)} * (0.75 + 0.25 * z);
    if (d2 > reach * reach) return vec4(0.0);

    // A soft rise, a brief peak and a longer fade. Not every flash is as
    // bright, and about one in ten is missed.
    float strength = fract(mod(lc.x, 89.0) * 0.618034 + k.z);
    float level = smoothstep(0.0, 0.2, s) * (1.0 - smoothstep(0.3, 1.0, s)) *
        smoothstep(0.06, 0.16, strength) * (0.55 + 0.45 * strength);

    // glow() gives its point a white core. Tinting the whole light cream
    // afterwards turns the core warm and brings the halo to 200,250,120. A
    // faint, wide bloom of the same colour surrounds both, polynomial so that
    // it reaches exactly zero at the edge of the reach.
    vec3 warm = vec3(1.0, 0.98, 0.75);
    vec4 c = glow(sqrt(d2) * U, (8.0 + 6.0 * z) * U, vec3(0.784, 1.0, 0.627), 0.3);
    c.rgb *= warm;
    float b = 1.0 - d2 / (reach * reach);
    float bloom = 0.24 * b * b * b;
    c += vec4(vec3(0.784, 0.98, 0.47) * bloom, bloom) * (1.0 - c.a);
    return c * level * (0.65 + 0.35 * z) * min(here, 1.0);
}

vec4 fireflies(vec2 p) {
    vec2 q = p / U;
    vec2 cell = vec2(floor(q.x / ${f(CELL_W)}) - 1.0, floor(q.y / ${f(CELL_H)} - 0.5));
    vec4 c = vec4(0.0);
    for (int y = 0; y < 2; y++) {
        // Thinning towards the top of the frame. The amount is a share of the
        // cells, and each firefly fades in or out as the share crosses its
        // own hash, rather than popping.
        float row = cell.y + float(y);
        float share = ${f(OCCUPIED)} * u_density *
            mix(${f(TOP)}, 1.0, smoothstep(0.0, ${f(RISE)}, (row + 0.5) * ${f(CELL_H)} * U / u_canvas.y));
        for (int x = 0; x < 3; x++)
            c += firefliesLight(q, vec2(cell.x + float(x), row), share);
    }
    return c;
}
`;
