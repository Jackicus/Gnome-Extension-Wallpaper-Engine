// Drifting points of light, joined by a line whenever two come close.
//
// The points are dealt out over three grids, one to a cell, and each grid
// drifts its own way -- so points from different grids slide past each other,
// meeting and parting the way free-flying ones would, and fall into close pairs
// as often. A cell is more than twice the longest link, so both ends of any link
// that could pass through a pixel lie in the 2x2 block of cells nearest it: four
// points a grid, twelve in all, is everything a pixel has to consider.
//
// The shader is written out here as straight-line code, one variable a point,
// rather than as loops over arrays. Indexed local arrays are what GPU
// compilers move out of registers into memory, and that alone made this
// pattern more than twice as dear.

const GRIDS = 3;
const LINK = 150;                                   // in U
const HALF = LINK / 2 + 1;
const CELL = 2 * (LINK + 2);                        // ~67 points on a 1080-line screen
const WANDER = 20;
const INSET = WANDER + 2;
const SPEED = 9;                                    // U a second
const REPEAT = 64;

// Fewer points, down to a quarter: a cell holds one point at most. Each has
// its own threshold, and fades out -- dot shrinking, links dimming -- over a
// narrow band of the setting as it passes, rather than vanishing.
export const density = [0.25, 1];

const POINTS = Array.from({ length: GRIDS * 4 }, (_, n) => n);
const grid = n => Math.floor(n / 4);

// Every other point that could share a link through this pixel with point n.
// A pair where both ends are near is only counted from the lower one.
const partners = n => POINTS.filter(m => m !== n).map(m =>
    `if (p${m}.w + p${n}.w < ${LINK + 2}.0${m < n ? ` && p${m}.w >= ${HALF}.0` : ''}) ` +
    `c += constellationLink(q, p${n}, p${m});`);

export const glsl = `
vec2 constellationShift(float g) {
    float angle = radians(20.0 + g * ${360 / GRIDS}.0);
    return scroll(${SPEED}.0 * vec2(cos(angle), sin(angle)), ${CELL * REPEAT}.0) + g * vec2(97.3, 53.9);
}

// A point: where it is (xy), its size (z; 0 when thinned out), and how far it
// is from q (w; out of reach when thinned out).
vec4 constellationPoint(vec2 q, vec2 shift, vec2 id, float g) {
    vec4 h = hash42(mod(id, ${REPEAT}.0) + vec2(u_seed + g * 31.7, 5.0));
    float w = 0.05 + 0.1 * fract(h.w * 7.31);
    vec2 wander = ${WANDER}.0 * vec2(sin(wphase(w) + h.z * TAU), cos(wphase(w * 1.3) + h.w * TAU));
    vec2 at = shift + id * ${CELL}.0 + ${INSET}.0 + h.xy * ${CELL - INSET * 2}.0 + wander;
    float here = clamp((u_density - fract(h.z * 31.7 + h.w * 17.3)) * 20.0 + 1.0, 0.0, 1.0);
    return vec4(at, (3.0 + fract(h.z * 13.7) * 4.0) * here, here > 0.0 ? length(q - at) : 1e6);
}

vec4 constellationLink(vec2 q, vec4 a, vec4 b) {
    float near = max(0.0, 1.0 - length(a.xy - b.xy) / ${LINK}.0);
    float fading = min(1.0, min(a.z, b.z) / 3.0);
    return vec4(0.784, 0.871, 1.0, 1.0) * 0.28 * near * near * fading * line(segmentDistance(q, a.xy, b.xy) * U, U);
}

vec4 constellation(vec2 p) {
    vec2 q = p / U;
    ${Array.from({ length: GRIDS }, (_, g) => `vec2 shift${g} = constellationShift(${g}.0);
    vec2 base${g} = floor((q - shift${g}) / ${CELL}.0 - 0.5);`).join('\n    ')}
    ${POINTS.map(n => `vec4 p${n} = constellationPoint(q, shift${grid(n)}, base${grid(n)} + ` +
        `vec2(${n % 2}.0, ${Math.floor(n / 2) % 2}.0), ${grid(n)}.0);`).join('\n    ')}

    // Two dots rarely come within a glow of each other, so only the nearest
    // is drawn.
    vec4 nearest = p0;
    ${POINTS.slice(1).map(n => `if (p${n}.w < nearest.w) nearest = p${n};`).join('\n    ')}
    vec4 c = glow(nearest.w * U, nearest.z * 1.2 * U, vec3(0.784, 0.871, 1.0), 0.3);

    // A pixel on a link is within half a link of one of its ends, which is
    // rarely more than one point -- so only those go looking for partners.
    ${POINTS.map(n => `if (p${n}.w < ${HALF}.0) {
        ${partners(n).join('\n        ')}
    }`).join('\n    ')}
    return c;
}
`;
