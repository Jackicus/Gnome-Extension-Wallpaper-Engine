import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// A scene is a look: which patterns, tuned how, over what. It is nothing but
// the values of these keys, so applying one is writing them, saving one is
// reading them, and a scene is "current" when they all match.
//
// Frame rate, pausing and spanning are left out on purpose: they are about the
// machine and the monitors, not about the look.
export const SCENE_KEYS = [
    'enabled-effects',
    'pattern-tuning',
    'background-mode',
    'color-palette',
    'custom-image',
    'speed',
    'opacity',
];

// Built in. Keys a scene leaves out go back to their defaults when it is
// applied -- except the custom picture, which a scene without one leaves be.
export const SCENES = [
    {
        name: 'Classic',
        desc: 'The wave and its sparkles over deep blue',
        values: { 'enabled-effects': ['wave', 'sparkles'], 'background-mode': 'color', 'color-palette': 'Classic Blue' },
    },
    {
        name: 'Accent',
        desc: 'The wave and its sparkles in your accent colour',
        values: { 'enabled-effects': ['wave', 'sparkles'], 'background-mode': 'accent' },
    },
    {
        name: 'Northern Lights',
        desc: 'Aurora curtains over a starry polar sky',
        values: { 'enabled-effects': ['aurora', 'starfield'], 'background-mode': 'color', 'color-palette': 'Aurora' },
    },
    {
        name: 'Deep Space',
        desc: 'Nebula clouds, stars and drifting constellations',
        values: {
            'enabled-effects': ['nebula', 'starfield', 'constellation'],
            'pattern-tuning': { constellation: { brightness: 0.8, density: 0.7 } },
            'background-mode': 'color',
            'color-palette': 'Nebula',
        },
    },
    {
        name: 'Campfire',
        desc: 'Embers rising through soft out-of-focus light',
        values: {
            'enabled-effects': ['embers', 'bokeh'],
            'pattern-tuning': { bokeh: { brightness: 0.7 } },
            'background-mode': 'color',
            'color-palette': 'Dusk',
        },
    },
    {
        name: 'Snowfall',
        desc: 'A quiet snowfall on a winter night',
        values: { 'enabled-effects': ['snow'], 'background-mode': 'color', 'color-palette': 'Classic Blue' },
    },
    {
        name: 'Rainy Evening',
        desc: 'Fine rain in front of blurred distant lights',
        values: {
            'enabled-effects': ['rain', 'bokeh'],
            'pattern-tuning': { bokeh: { brightness: 0.6, density: 0.75 } },
            'background-mode': 'color',
            'color-palette': 'Dark',
        },
    },
    {
        name: 'Summer Night',
        desc: 'Fireflies under a few faint stars',
        values: {
            'enabled-effects': ['starfield', 'fireflies'],
            'pattern-tuning': { starfield: { brightness: 0.6, density: 0.4 } },
            'background-mode': 'color',
            'color-palette': 'Green',
        },
    },
    {
        name: 'Topography',
        desc: 'A living relief map in your accent colour',
        values: { 'enabled-effects': ['contours'], 'background-mode': 'accent' },
    },
];

const typeOf = (settings, key) => settings.settings_schema.get_key(key).get_value_type().dup_string();

// A built-in scene's values as GVariants, the way saved ones already are.
function variants(settings, scene) {
    if (scene.saved) return scene.values;
    return Object.fromEntries(Object.entries(scene.values)
        .map(([key, value]) => [key, new GLib.Variant(typeOf(settings, key), value)]));
}

// Plain JSON with sorted keys and a sorted pattern list, so the same look
// compares equal however its patterns and tunings happen to be listed.
function canonical(key, variant) {
    const sort = v => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]))
        : Array.isArray(v) ? v.map(sort) : v);
    const value = variant.recursiveUnpack();
    return JSON.stringify(key === 'enabled-effects' ? [...value].sort() : sort(value));
}

/**
 * Writes a scene's values, as one change.
 *
 * Through a settings object of its own: delay() has no way back, so on the
 * shared one every later edit in the window would sit unapplied, shown in the
 * rows but never reaching the shell.
 */
export function applyScene(settings, scene) {
    const values = variants(settings, scene);
    const batch = new Gio.Settings({ settings_schema: settings.settings_schema, backend: settings.backend });
    batch.delay();
    for (const key of SCENE_KEYS) {
        if (values[key]) batch.set_value(key, values[key]);
        else if (key !== 'custom-image') batch.reset(key);
    }
    batch.apply();
}

/** Whether the settings are showing this scene right now. */
export function isCurrent(settings, scene) {
    const values = variants(settings, scene);
    return SCENE_KEYS.every(key => {
        if (key === 'custom-image' && !values[key]) return true;
        const want = values[key] ?? settings.get_default_value(key);
        return canonical(key, settings.get_value(key)) === canonical(key, want);
    });
}

/** The user's own scenes, in the order they were saved. */
export function savedScenes(settings) {
    return settings.get_value('saved-scenes').deepUnpack().map(({ name, ...values }) => ({
        name: name.unpack(),
        values,
        saved: true,
    }));
}

/** Saves what is showing now under `name`, replacing a scene of that name. */
export function saveScene(settings, name) {
    const values = Object.fromEntries(SCENE_KEYS.map(key => [key, settings.get_value(key)]));
    const others = savedScenes(settings).filter(s => s.name !== name);
    writeSaved(settings, [...others, { name, values }]);
}

export function deleteScene(settings, name) {
    writeSaved(settings, savedScenes(settings).filter(s => s.name !== name));
}

function writeSaved(settings, scenes) {
    settings.set_value('saved-scenes', new GLib.Variant('aa{sv}',
        scenes.map(({ name, values }) => ({ name: new GLib.Variant('s', name), ...values }))));
}
