export const TAU = Math.PI * 2;

/**
 * Seeded PRNG (mulberry32), for what the layers work out on the CPU: a fixed
 * seed keeps a pattern's layout identical across reloads, which is the only
 * way to tell a deliberate visual change from noise in a screenshot.
 */
export function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
