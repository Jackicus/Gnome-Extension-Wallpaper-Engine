import { WaveLayer } from './layers/wave.js';
import { SparklesLayer } from './layers/sparkles.js';
import { NebulaLayer } from './layers/nebula.js';
import { AuroraLayer } from './layers/aurora.js';
import { StarfieldLayer } from './layers/starfield.js';
import { EmbersLayer } from './layers/embers.js';
import { BokehLayer } from './layers/bokeh.js';
import { ConstellationLayer } from './layers/constellation.js';

export const EFFECTS = [
    {
        id: 'wave',
        title: 'Wave',
        desc: 'The iconic ribbon: folded sheets of light with bright crest glints',
        icon: 'view-wrapped-symbolic',
        create: () => new WaveLayer(),
    },
    {
        id: 'sparkles',
        title: 'Sparkles',
        desc: 'Drifting, depth-scaled specks with a soft flare',
        icon: 'starred-symbolic',
        create: () => new SparklesLayer(),
    },
    {
        id: 'nebula',
        title: 'Nebula',
        desc: 'Slow clouds of violet, teal and magenta light turning over each other',
        icon: 'weather-overcast-symbolic',
        create: () => new NebulaLayer(),
    },
    {
        id: 'aurora',
        title: 'Aurora',
        desc: 'Green and violet curtains of polar light drifting across the sky',
        icon: 'weather-fog-symbolic',
        create: () => new AuroraLayer(),
    },
    {
        id: 'starfield',
        title: 'Starfield',
        desc: 'Deep night sky with layered stars, galactic band and meteors',
        icon: 'night-light-symbolic',
        create: () => new StarfieldLayer(),
    },
    {
        id: 'embers',
        title: 'Embers',
        desc: 'Rising sparks cooling from white through orange to red',
        icon: 'weather-storm-symbolic',
        create: () => new EmbersLayer(),
    },
    {
        id: 'bokeh',
        title: 'Bokeh',
        desc: 'Large out-of-focus lights rising softly through the frame',
        icon: 'camera-photo-symbolic',
        create: () => new BokehLayer(),
    },
    {
        id: 'constellation',
        title: 'Constellation',
        desc: 'Drifting points that dynamically weave into a connected mesh',
        icon: 'network-workgroup-symbolic',
        create: () => new ConstellationLayer(),
    },
];

export const DEFAULT_EFFECT_IDS = ['wave', 'sparkles'];

const EFFECT_MAP = new Map(EFFECTS.map(e => [e.id, e]));

export function getEffect(id) {
    return EFFECT_MAP.get(id) || null;
}

export function parseEffectIds(raw) {
    let list = raw;
    if (typeof raw === 'string') {
        try {
            list = JSON.parse(raw);
        } catch {
            return [...DEFAULT_EFFECT_IDS];
        }
    }
    if (!Array.isArray(list)) return [...DEFAULT_EFFECT_IDS];
    const wanted = new Set(list.filter(id => typeof id === 'string' && EFFECT_MAP.has(id)));
    return EFFECTS.filter(e => wanted.has(e.id)).map(e => e.id);
}
