// Contour lines of a slowly changing landscape: a relief map drawn in light,
// every fifth line an index contour a little brighter, and the high ground
// catching more of the light than the hollows.
//
// The height is three octaves of simplex noise whose gradients turn as time
// passes, each lattice point at its own rate ("flow noise"), so the hills swell,
// merge and split where they stand instead of sliding past. The noise gives its
// derivatives analytically, alongside its value -- finite differences would
// have meant evaluating it three times over -- and that is what keeps every line
// one width: the distance to the nearest level, divided by how fast the height
// changes there, is the distance in pixels, on a cliff or a plain alike.
//
// That estimate only goes wrong where the ground levels out -- a peak, a pit, a
// pass -- where a closing loop would shrink to a dot and two lines meeting at a
// saddle would knot. So lines fade out on nearly level ground, judged by the
// gradient alone so that the Amount does not change it; in practice that is
// only ever the last few pixels of a loop, or the crossing of a pass. Lines
// crowding closer than a few widths fade too, rather than alias. Nothing can be
// culled early: whether a pixel is on a line depends on every octave.

// Levels per unit of height at an Amount of 1: a line every 25 px or so on an
// average slope of a 1080-line screen. The height spans roughly -1.5 to 1.5.
const LEVELS = 9.0;

// Fewer or more levels over the same ground. A level is a height, so as the
// Amount moves the lines slide continuously and new ones open out of the peaks.
export const density = [0.5, 2];

export const glsl = `
const float CONTOURS_F = 0.366025404;   // (sqrt(3) - 1) / 2
const float CONTOURS_G = 0.211324865;   // (3 - sqrt(3)) / 6

// The permutation polynomial of Gustavson and McEwan's simplex noise: exact in
// floats for integers under 289, and far cheaper than hashing each corner.
vec3 contoursPermute(vec3 x) {
    return mod((x * 34.0 + 1.0) * x, 289.0);
}

// Simplex noise in about [-1, 1], with its gradient in .yz. Each corner's
// gradient starts at its own angle and turns at its own rate: a whole multiple,
// from -20 to 20, of one slow phase. Whole multiples keep the field seamless as
// the epoch rolls over, and share a single wphase() between the three corners;
// an octave only repeats after 20 turns of that phase, 38 to 75 minutes.
vec3 contoursNoise(vec2 x, float rate, float seed) {
    vec2 i = floor(x + (x.x + x.y) * CONTOURS_F);
    vec2 x0 = x - i + (i.x + i.y) * CONTOURS_G;
    vec2 o = x0.x > x0.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec2 x1 = x0 - o + CONTOURS_G;
    vec2 x2 = x0 - 1.0 + 2.0 * CONTOURS_G;

    i = mod(i + seed, 289.0);
    vec3 hp = contoursPermute(contoursPermute(i.y + vec3(0.0, o.y, 1.0)) + i.x + vec3(0.0, o.x, 1.0));
    vec3 turns = hp - 41.0 * floor(hp * (1.0 / 41.0)) - 20.0;
    vec3 a = hp * (TAU / 289.0) + turns * wphase(rate / 20.0);
    vec3 gx = cos(a);
    vec3 gy = sin(a);

    vec3 dx = vec3(x0.x, x1.x, x2.x);
    vec3 dy = vec3(x0.y, x1.y, x2.y);
    vec3 t = max(0.5 - dx * dx - dy * dy, 0.0);
    vec3 t2 = t * t;
    vec3 t4 = t2 * t2;
    vec3 gd = gx * dx + gy * dy;
    vec3 s = 8.0 * t2 * t * gd;
    return 70.0 * vec3(dot(t4, gd), dot(t4, gx) - dot(s, dx), dot(t4, gy) - dot(s, dy));
}

vec4 contours(vec2 p) {
    // Hills about a third of a 1080p screen across, then two finer octaves,
    // each turned against the one before so their lattices never line up, and
    // each turning a little faster than the one before.
    float seed = floor(mod(u_seed * 61.0, 289.0));
    float k = 2.6 / DESIGN_W;
    vec2 x = p * k;
    vec3 n = contoursNoise(x, 0.028, seed);
    mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    vec3 m = contoursNoise(r * x * 2.1 + vec2(11.3, -7.9), 0.04, seed + 101.0);
    mat2 r2 = mat2(0.28, -0.96, 0.96, 0.28);
    vec3 q = contoursNoise(r2 * x * 4.7 + vec2(-5.1, 3.7), 0.055, seed + 197.0);
    float h = n.x + 0.4 * m.x + 0.12 * q.x;
    vec2 grad = (n.yz + 0.4 * 2.1 * (m.yz * r) + 0.12 * 4.7 * (q.yz * r2)) * k;

    // Heights in levels, the index contours offset off zero -- where the first
    // octave's lattice points sit for ever -- and the distance to the nearest.
    float levels = ${LEVELS.toFixed(1)} * u_density;
    float v = h * levels + 0.5;
    float level = floor(v + 0.5);
    float slope = length(grad) * levels;                // levels per pixel
    float d = abs(v - level) / max(slope, 1e-5);        // pixels to that line

    bool index = abs(mod(level + 2.5, 5.0) - 2.5) < 0.5;
    float w = (index ? 1.5 : 1.0) * U;
    float a = (index ? 0.34 : 0.17) * line(d, w);
    a *= smoothstep(1.0e-4, 3.0e-4, length(grad) * U);  // level ground
    a *= smoothstep(3.0, 7.0, 1.0 / (slope * U));       // crowding
    a *= mix(0.55, 1.3, smoothstep(-0.7, 0.7, h));      // relief
    return vec4(0.78, 0.95, 0.96, 1.0) * a;
}
`;
