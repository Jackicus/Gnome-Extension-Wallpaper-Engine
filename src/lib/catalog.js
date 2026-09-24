import * as nebula from './layers/nebula.js';
import * as aurora from './layers/aurora.js';
import * as contours from './layers/contours.js';
import * as starfield from './layers/starfield.js';
import * as wave from './layers/wave.js';
import * as constellation from './layers/constellation.js';
import * as sparkles from './layers/sparkles.js';
import * as embers from './layers/embers.js';
import * as fireflies from './layers/fireflies.js';
import * as bokeh from './layers/bokeh.js';
import * as snow from './layers/snow.js';
import * as rain from './layers/rain.js';

// Every pattern, in the order they are drawn: the sky first, the weather last,
// since each is laid over the ones before it. A layer module gives its shader
// (`glsl`, defining a function named after the id), the range of its Amount
// setting if it has one (`density`), and, when the shader needs something
// worked out on the CPU each frame, a `State` class that does it.
export const EFFECTS = [
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
        id: 'contours',
        title: 'Contours',
        desc: 'Topographic lines of a slowly shifting landscape, drawn in faint light',
        ...contours,
    },
    {
        id: 'starfield',
        title: 'Starfield',
        desc: 'Deep night sky with layered stars, galactic band and meteors',
        ...starfield,
    },
    {
        id: 'wave',
        title: 'Wave',
        desc: 'The iconic ribbon: folded sheets of light with bright crest glints',
        ...wave,
    },
    {
        id: 'constellation',
        title: 'Constellation',
        desc: 'Drifting points that dynamically weave into a connected mesh',
        ...constellation,
    },
    {
        id: 'sparkles',
        title: 'Sparkles',
        desc: 'Drifting, depth-scaled specks with a soft flare',
        ...sparkles,
    },
    {
        id: 'embers',
        title: 'Embers',
        desc: 'Rising sparks cooling from white through orange to red',
        ...embers,
    },
    {
        id: 'fireflies',
        title: 'Fireflies',
        desc: 'Warm yellow-green lights wandering low and blinking on slow rhythms',
        ...fireflies,
    },
    {
        id: 'bokeh',
        title: 'Bokeh',
        desc: 'Large out-of-focus lights rising softly through the frame',
        ...bokeh,
    },
    {
        id: 'snow',
        title: 'Snow',
        desc: 'Snowflakes drifting down at several depths, swaying in a light wind',
        ...snow,
    },
    {
        id: 'rain',
        title: 'Rain',
        desc: 'Fine streaks of rain falling at a slant, near drops longer and faster',
        ...rain,
    },
];
