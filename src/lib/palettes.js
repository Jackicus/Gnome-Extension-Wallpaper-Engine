import cairo from 'cairo';

export const PALETTES = {
    'Classic Blue': {
        title: 'Classic Blue',
        desc: 'Original PS3 signature deep blue backdrop',
        stops: [
            [0.0, 6 / 255, 19 / 255, 31 / 255],
            [0.4, 11 / 255, 42 / 255, 74 / 255],
            [0.7, 18 / 255, 60 / 255, 102 / 255],
            [1.0, 10 / 255, 31 / 255, 56 / 255],
        ],
    },
    'Dark': {
        title: 'Dark',
        desc: 'Midnight obsidian backdrop',
        stops: [
            [0.0, 6 / 255, 6 / 255, 6 / 255],
            [0.4, 19 / 255, 20 / 255, 23 / 255],
            [0.7, 30 / 255, 32 / 255, 36 / 255],
            [1.0, 10 / 255, 11 / 255, 13 / 255],
        ],
    },
    'Red': {
        title: 'Red',
        desc: 'Vibrant crimson red wave backdrop',
        stops: [
            [0.0, 31 / 255, 6 / 255, 7 / 255],
            [0.4, 74 / 255, 11 / 255, 18 / 255],
            [0.7, 109 / 255, 20 / 255, 32 / 255],
            [1.0, 56 / 255, 10 / 255, 16 / 255],
        ],
    },
    'Green': {
        title: 'Green',
        desc: 'Rich emerald green wave backdrop',
        stops: [
            [0.0, 5 / 255, 23 / 255, 13 / 255],
            [0.4, 13 / 255, 58 / 255, 34 / 255],
            [0.7, 20 / 255, 87 / 255, 47 / 255],
            [1.0, 8 / 255, 36 / 255, 20 / 255],
        ],
    },
    'Gold': {
        title: 'Gold',
        desc: 'Warm metallic gold wave backdrop',
        stops: [
            [0.0, 31 / 255, 23 / 255, 4 / 255],
            [0.4, 74 / 255, 55 / 255, 8 / 255],
            [0.7, 109 / 255, 83 / 255, 16 / 255],
            [1.0, 56 / 255, 42 / 255, 6 / 255],
        ],
    },
    'Aurora': {
        title: 'Aurora',
        desc: 'Cold green and violet polar night sky',
        stops: [
            [0.0, 6 / 255, 13 / 255, 28 / 255],
            [0.35, 10 / 255, 23 / 255, 48 / 255],
            [0.65, 16 / 255, 38 / 255, 52 / 255],
            [1.0, 3 / 255, 6 / 255, 13 / 255],
        ],
    },
    'Dusk': {
        title: 'Dusk',
        desc: 'Sunset ember banked low under indigo night',
        stops: [
            [0.0, 16 / 255, 10 / 255, 32 / 255],
            [0.4, 38 / 255, 16 / 255, 48 / 255],
            [0.75, 75 / 255, 26 / 255, 38 / 255],
            [1.0, 20 / 255, 8 / 255, 14 / 255],
        ],
    },
    'Nebula': {
        title: 'Nebula',
        desc: 'Distant violet nebula in deep space',
        stops: [
            [0.0, 12 / 255, 6 / 255, 28 / 255],
            [0.4, 28 / 255, 12 / 255, 54 / 255],
            [0.7, 42 / 255, 18 / 255, 78 / 255],
            [1.0, 8 / 255, 4 / 255, 20 / 255],
        ],
    },
};

export const PALETTE_NAMES = Object.keys(PALETTES);

/**
 * Paints a color palette gradient over the given dimensions.
 */
export function paintPalette(cr, name, w, h) {
    const palette = PALETTES[name] || PALETTES['Classic Blue'];
    const grad = new cairo.LinearGradient(w * 0.1, 0, w * 0.9, h);
    for (const [offset, r, g, b] of palette.stops) {
        grad.addColorStopRGBA(offset, r, g, b, 1.0);
    }
    cr.save();
    cr.setOperator(cairo.Operator.SOURCE);
    cr.setSource(grad);
    cr.paint();
    cr.restore();
}
