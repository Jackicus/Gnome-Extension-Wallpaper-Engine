import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { EFFECTS } from './lib/catalog.js';
import { PALETTES } from './lib/palettes.js';
import { SCENES, SCENE_KEYS, applyScene, deleteScene, isCurrent, saveScene, savedScenes } from './lib/scenes.js';

const tuningOf = settings => settings.get_value('pattern-tuning').deepUnpack();

// One pattern's setting, left out of the dictionary when it is back at 1.
function writeTuning(settings, id, key, value) {
    const all = tuningOf(settings);
    const mine = { ...(all[id] ?? {}) };
    if (Math.abs(value - 1) < 1e-6) delete mine[key];
    else mine[key] = value;
    if (Object.keys(mine).length) all[id] = mine;
    else delete all[id];
    settings.set_value('pattern-tuning', new GLib.Variant('a{sa{sd}}', all));
}

export default class WallpaperEnginePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 700);
        window.set_search_enabled(true);

        // Rows that follow a key by hand register here, and the whole lot is
        // dropped when the window closes -- one handler, rather than one per
        // row left holding callbacks into destroyed widgets.
        const watchers = [];
        const handlerId = settings.connect('changed', (_s, key) => {
            for (const [k, fn] of watchers) if (k === key) fn();
        });
        window.connect('close-request', () => settings.disconnect(handlerId));

        const ui = { window, settings, watch: (key, fn) => watchers.push([key, fn]) };
        window.add(this._scenesPage(ui));
        window.add(this._patternsPage(ui));
        window.add(this._backgroundPage(ui));
        window.add(this._performancePage(ui));
    }

    /**
     * A row that writes a key and follows it when it changes elsewhere; for
     * everything GSettings cannot bind by itself.
     *
     * The guard matters: showing a value fires the row's own change signal,
     * and without it the write-back can land mid-update -- a combo row reports
     * no selection then, which used to rewrite the key to its first choice.
     */
    _follow({ watch }, key, show, onUserChange) {
        let showing = false;
        const refresh = () => {
            showing = true;
            try {
                show();
            } finally {
                showing = false;
            }
        };
        refresh();
        watch(key, refresh);
        return (...args) => {
            if (!showing) onUserChange(...args);
        };
    }

    /** A combo row over a key, from a list of { value, label } choices. */
    _comboRow(ui, { key, choices, read, write, ...props }) {
        const model = new Gtk.StringList();
        for (const choice of choices) model.append(choice.label);
        const row = new Adw.ComboRow({ ...props, model });

        const indexOf = value => Math.max(0, choices.findIndex(c => c.value === value));
        row.connect('notify::selected', this._follow(ui, key,
            () => row.set_selected(indexOf(read(ui.settings, key))),
            () => {
                const choice = choices[row.get_selected()];
                if (choice) write(ui.settings, key, choice.value);
            }));
        return row;
    }

    _switchRow({ settings }, key, props) {
        const row = new Adw.SwitchRow(props);
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _scenesPage(ui) {
        const { settings } = ui;
        const page = new Adw.PreferencesPage({ title: 'Scenes', icon_name: 'view-grid-symbolic' });

        // Every scene row shows a tick while its look is the one showing.
        const ticks = [];
        const refreshTicks = () => {
            for (const [scene, tick] of ticks) tick.visible = isCurrent(settings, scene);
        };
        for (const key of SCENE_KEYS) ui.watch(key, refreshTicks);

        const sceneRow = (group, scene, suffix) => {
            const row = new Adw.ActionRow({ title: scene.name, subtitle: scene.desc ?? '', activatable: true });
            const tick = new Gtk.Image({ icon_name: 'object-select-symbolic', visible: isCurrent(settings, scene) });
            row.add_suffix(tick);
            if (suffix) row.add_suffix(suffix);
            row.connect('activated', () => applyScene(settings, scene));
            ticks.push([scene, tick]);
            group.add(row);
            return row;
        };

        const builtIn = new Adw.PreferencesGroup({
            title: 'Scenes',
            description: 'A whole look in one click: the patterns, how each is tuned, and what they are drawn over. ' +
                'Frame rate and pausing stay as they are.',
        });
        page.add(builtIn);
        for (const scene of SCENES) sceneRow(builtIn, scene);

        const yours = new Adw.PreferencesGroup({ title: 'Your Scenes' });
        page.add(yours);

        const save = new Adw.EntryRow({ title: 'Save the current look as…', show_apply_button: true });
        save.connect('apply', () => {
            const name = save.text.trim();
            if (!name) return;
            saveScene(settings, name);
            save.text = '';
        });
        yours.add(save);

        // Rebuilt whenever the saved list changes, from here or anywhere.
        let rows = [];
        const showSaved = () => {
            for (const row of rows) yours.remove(row);
            rows = [];
            ticks.splice(SCENES.length);
            for (const scene of savedScenes(settings)) {
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    tooltip_text: 'Delete this scene',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['flat'],
                });
                remove.connect('clicked', () => deleteScene(settings, scene.name));
                rows.push(sceneRow(yours, scene, remove));
            }
        };
        showSaved();
        ui.watch('saved-scenes', showSaved);

        return page;
    }

    _patternsPage(ui) {
        const { settings } = ui;
        const page = new Adw.PreferencesPage({ title: 'Patterns', icon_name: 'view-wrapped-symbolic' });

        const group = new Adw.PreferencesGroup({
            title: 'Patterns',
            description: 'Any combination can be on at once, drawn over each other. Open one to tune it.',
        });
        page.add(group);

        const enabled = () => new Set(settings.get_strv('enabled-effects'));
        for (const effect of EFFECTS) {
            const row = new Adw.ExpanderRow({ title: effect.title, subtitle: effect.desc });
            const toggle = new Gtk.Switch({ valign: Gtk.Align.CENTER });
            toggle.connect('notify::active', this._follow(ui, 'enabled-effects',
                () => (toggle.active = enabled().has(effect.id)),
                () => {
                    const ids = enabled();
                    if (toggle.active) ids.add(effect.id);
                    else ids.delete(effect.id);
                    // In catalog order, which is the order they are drawn in.
                    settings.set_strv('enabled-effects', EFFECTS.filter(e => ids.has(e.id)).map(e => e.id));
                }));
            row.add_suffix(toggle);

            row.add_row(this._tuningRow(ui, effect, 'brightness', 'Brightness (%)', [0.1, 2]));
            row.add_row(this._tuningRow(ui, effect, 'speed', 'Speed (%)', [0.25, 3]));
            if (effect.density)
                row.add_row(this._tuningRow(ui, effect, 'density', 'Amount (%)', effect.density));

            const reset = new Adw.ActionRow({ title: 'Back to how it was designed' });
            const button = new Gtk.Button({ label: 'Reset', valign: Gtk.Align.CENTER });
            button.connect('clicked', () => {
                const all = tuningOf(settings);
                delete all[effect.id];
                settings.set_value('pattern-tuning', new GLib.Variant('a{sa{sd}}', all));
            });
            reset.add_suffix(button);
            row.add_row(reset);

            group.add(row);
        }

        const all = new Adw.PreferencesGroup({ title: 'All Patterns' });
        page.add(all);

        const speed = new Adw.SpinRow({
            title: 'Animation Speed',
            subtitle: 'How fast everything moves (0.25× – 3×)',
            digits: 2,
            adjustment: new Gtk.Adjustment({ lower: 0.25, upper: 3.0, step_increment: 0.25 }),
        });
        settings.bind('speed', speed, 'value', Gio.SettingsBindFlags.DEFAULT);
        all.add(speed);

        // Stored as a fraction, shown as a percentage.
        const opacity = new Adw.SpinRow({
            title: 'Pattern Opacity (%)',
            subtitle: 'How strongly the patterns show over the background',
            adjustment: new Gtk.Adjustment({ lower: 10, upper: 100, step_increment: 5 }),
        });
        opacity.connect('notify::value', this._follow(ui, 'opacity',
            () => opacity.set_value(Math.round(settings.get_double('opacity') * 100)),
            () => settings.set_double('opacity', opacity.get_value() / 100)));
        all.add(opacity);

        all.add(this._switchRow(ui, 'span-monitors', {
            title: 'Span All Monitors',
            subtitle: 'Draw one picture across every monitor, instead of one on each',
        }));

        return page;
    }

    /** One pattern's brightness, speed or amount, as a percentage of its design. */
    _tuningRow(ui, effect, key, title, [low, high]) {
        const { settings } = ui;
        const row = new Adw.SpinRow({
            title,
            adjustment: new Gtk.Adjustment({ lower: low * 100, upper: high * 100, step_increment: 5 }),
        });
        row.connect('notify::value', this._follow(ui, 'pattern-tuning',
            () => row.set_value(Math.round((tuningOf(settings)[effect.id]?.[key] ?? 1) * 100)),
            () => writeTuning(settings, effect.id, key, row.get_value() / 100)));
        return row;
    }

    _backgroundPage(ui) {
        const { window, settings } = ui;
        const page = new Adw.PreferencesPage({
            title: 'Background',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });
        const group = new Adw.PreferencesGroup({
            title: 'Base Layer',
            description: 'What the patterns are drawn over. The overview and the workspace switcher show it too.',
        });
        page.add(group);

        // The accent colour came in GNOME 47; before it, the mode draws blue.
        const hasAccent = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' })
            .settings_schema.has_key('accent-color');

        group.add(this._comboRow(ui, {
            key: 'background-mode',
            title: 'Background',
            choices: [
                { value: 'desktop', label: 'Desktop Wallpaper' },
                { value: 'accent', label: hasAccent ? 'Accent Color' : 'Accent Color (Blue)' },
                { value: 'color', label: 'Color Gradient' },
                { value: 'image', label: 'Custom Picture' },
            ],
            read: (s, k) => s.get_string(k),
            write: (s, k, v) => s.set_string(k, v),
        }));

        const palette = this._comboRow(ui, {
            key: 'color-palette',
            title: 'Color Palette',
            choices: Object.keys(PALETTES).map(name => ({ value: name, label: name })),
            read: (s, k) => s.get_string(k),
            write: (s, k, v) => s.set_string(k, v),
        });
        group.add(palette);

        const image = new Adw.ActionRow({ title: 'Custom Picture' });
        const showImage = () => (image.subtitle = settings.get_string('custom-image') || 'No picture selected');
        showImage();
        ui.watch('custom-image', showImage);

        const browse = new Gtk.Button({ label: 'Browse…', valign: Gtk.Align.CENTER });
        browse.connect('clicked', () => {
            const filter = new Gtk.FileFilter({ name: 'Images' });
            for (const type of ['image/png', 'image/jpeg', 'image/webp']) filter.add_mime_type(type);
            const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filters.append(filter);

            const dialog = new Gtk.FileDialog({ title: 'Select Wallpaper Image', filters, default_filter: filter });
            const current = settings.get_string('custom-image');
            if (current) dialog.set_initial_file(Gio.File.new_for_path(current));

            dialog.open(window, null, (self, result) => {
                try {
                    const path = self.open_finish(result)?.get_path();
                    if (path) settings.set_string('custom-image', path);
                } catch {
                    // Dismissed, or the portal refused -- nothing to report.
                }
            });
        });
        image.add_suffix(browse);

        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear the chosen picture',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clear.connect('clicked', () => settings.set_string('custom-image', ''));
        image.add_suffix(clear);
        group.add(image);

        // Only the rows the mode uses are live, whichever way the mode changed.
        const applyMode = () => {
            const mode = settings.get_string('background-mode');
            palette.sensitive = mode === 'color';
            image.sensitive = mode === 'image';
        };
        applyMode();
        ui.watch('background-mode', applyMode);

        return page;
    }

    _performancePage(ui) {
        const page = new Adw.PreferencesPage({ title: 'Performance', icon_name: 'utilities-system-monitor-symbolic' });
        const group = new Adw.PreferencesGroup({
            title: 'Frame Rate and Power',
            description: 'The patterns are drawn by the GPU, in step with each display. They also rest while ' +
                'the power saver mode is on, or animations are turned off, since those are choices made for ' +
                'the whole system.',
        });
        page.add(group);

        group.add(this._comboRow(ui, {
            key: 'target-fps',
            title: 'Frame Rate',
            subtitle: 'Counted in frames each display actually shows, so motion stays even at any refresh rate',
            subtitle_lines: 0,
            choices: [
                { value: 0, label: 'Every frame' },
                { value: -2, label: 'Every other frame' },
                { value: 60, label: 'About 60 per second' },
                { value: 30, label: 'About 30 per second' },
            ],
            read: (s, k) => {
                const value = s.get_int(k);
                if (value <= 0) return value <= -2 ? -2 : 0;
                return value >= 45 ? 60 : 30;
            },
            write: (s, k, v) => s.set_int(k, v),
        }));

        group.add(this._switchRow(ui, 'pause-when-covered', {
            title: 'Pause While Covered',
            subtitle: 'Stops the animation on a monitor while fullscreen, maximized or tiled windows hide its desktop',
        }));
        group.add(this._switchRow(ui, 'pause-on-battery', {
            title: 'Pause on Battery Power',
            subtitle: 'Stops the animation while the device runs on battery',
        }));

        return page;
    }
}
