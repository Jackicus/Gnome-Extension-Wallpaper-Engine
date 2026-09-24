import cairo from 'cairo';

// The gradients for `color` mode: stops along a diagonal, as [offset, r, g, b]
// in 0-255.
export const PALETTES = {
    'Classic Blue': [[0.0, 6, 19, 31], [0.4, 11, 42, 74], [0.7, 18, 60, 102], [1.0, 10, 31, 56]],
    'Dark': [[0.0, 6, 6, 6], [0.4, 19, 20, 23], [0.7, 30, 32, 36], [1.0, 10, 11, 13]],
    'Red': [[0.0, 31, 6, 7], [0.4, 74, 11, 18], [0.7, 109, 20, 32], [1.0, 56, 10, 16]],
    'Green': [[0.0, 5, 23, 13], [0.4, 13, 58, 34], [0.7, 20, 87, 47], [1.0, 8, 36, 20]],
    'Gold': [[0.0, 31, 23, 4], [0.4, 74, 55, 8], [0.7, 109, 83, 16], [1.0, 56, 42, 6]],
    'Aurora': [[0.0, 6, 13, 28], [0.35, 10, 23, 48], [0.65, 16, 38, 52], [1.0, 3, 6, 13]],
    'Dusk': [[0.0, 16, 10, 32], [0.4, 38, 16, 48], [0.75, 75, 26, 38], [1.0, 20, 8, 14]],
    'Nebula': [[0.0, 12, 6, 28], [0.4, 28, 12, 54], [0.7, 42, 18, 78], [1.0, 8, 4, 20]],
};

/** The stops of a palette, falling back to the default for an unknown name. */
export function paletteStops(name) {
    return PALETTES[name] ?? PALETTES['Classic Blue'];
}

/** Paints a palette's gradient over w x h. */
export function paintPalette(cr, name, w, h) {
    const grad = new cairo.LinearGradient(w * 0.1, 0, w * 0.9, h);
    for (const [offset, r, g, b] of paletteStops(name))
        grad.addColorStopRGBA(offset, r / 255, g / 255, b / 255, 1.0);
    cr.save();
    cr.setOperator(cairo.Operator.SOURCE);
    cr.setSource(grad);
    cr.paint();
    cr.restore();
}
