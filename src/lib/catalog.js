import * as wave from './layers/wave.js';
import * as sparkles from './layers/sparkles.js';
import * as nebula from './layers/nebula.js';
import * as aurora from './layers/aurora.js';
import * as starfield from './layers/starfield.js';
import * as embers from './layers/embers.js';
import * as bokeh from './layers/bokeh.js';
import * as constellation from './layers/constellation.js';

// Every pattern, in the order they are drawn. A layer module gives its shader
// (`glsl`, defining a function named after the id) and, when the shader needs
// something worked out on the CPU each frame, a `State` class that does it.
export const EFFECTS = [
    {
        id: 'wave',
        title: 'Wave',
        desc: 'The iconic ribbon: folded sheets of light with bright crest glints',
        ...wave,
    },
    {
        id: 'sparkles',
        title: 'Sparkles',
        desc: 'Drifting, depth-scaled specks with a soft flare',
        ...sparkles,
    },
    {
        id: 'nebula',
        title: 'Nebula',
        desc: 'Slow clouds of violet, teal and magenta light turning over each other',
        ...nebula,
    },
    {
        id: 'aurora',
        title: 'Aurora',
        desc: 'Green and violet curtains of polar light drifting across the sky',
        ...aurora,
    },
    {
        id: 'starfield',
        title: 'Starfield',
        desc: 'Deep night sky with layered stars, galactic band and meteors',
        ...starfield,
    },
    {
        id: 'embers',
        title: 'Embers',
        desc: 'Rising sparks cooling from white through orange to red',
        ...embers,
    },
    {
        id: 'bokeh',
        title: 'Bokeh',
        desc: 'Large out-of-focus lights rising softly through the frame',
        ...bokeh,
    },
    {
        id: 'constellation',
        title: 'Constellation',
        desc: 'Drifting points that dynamically weave into a connected mesh',
        ...constellation,
    },
];
