import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { EFFECTS } from './lib/catalog.js';
import { PALETTES } from './lib/palettes.js';

export default class WallpaperEnginePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(640, 620);
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
    _follow({ settings, watch }, key, show, onUserChange) {
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

    _patternsPage(ui) {
        const { settings } = ui;
        const page = new Adw.PreferencesPage({ title: 'Patterns', icon_name: 'view-wrapped-symbolic' });

        const group = new Adw.PreferencesGroup({
            title: 'Active Patterns',
            description: 'Any combination can be on at once; they are drawn over each other.',
        });
        page.add(group);

        const enabled = () => new Set(settings.get_strv('enabled-effects'));
        for (const effect of EFFECTS) {
            const row = new Adw.SwitchRow({ title: effect.title, subtitle: effect.desc });
            row.connect('notify::active', this._follow(ui, 'enabled-effects',
                () => (row.active = enabled().has(effect.id)),
                () => {
                    const ids = enabled();
                    if (row.active) ids.add(effect.id);
                    else ids.delete(effect.id);
                    // In catalog order, which is the order they are drawn in.
                    settings.set_strv('enabled-effects', EFFECTS.filter(e => ids.has(e.id)).map(e => e.id));
                }));
            group.add(row);
        }

        const tuning = new Adw.PreferencesGroup({ title: 'Tuning' });
        page.add(tuning);

        const speed = new Adw.SpinRow({
            title: 'Animation Speed',
            subtitle: 'How fast everything moves (0.25× – 3×)',
            digits: 2,
            adjustment: new Gtk.Adjustment({ lower: 0.25, upper: 3.0, step_increment: 0.25 }),
        });
        settings.bind('speed', speed, 'value', Gio.SettingsBindFlags.DEFAULT);
        tuning.add(speed);

        // Stored as a fraction, shown as a percentage.
        const opacity = new Adw.SpinRow({
            title: 'Pattern Opacity (%)',
            subtitle: 'How strongly the patterns show over the background',
            adjustment: new Gtk.Adjustment({ lower: 10, upper: 100, step_increment: 5 }),
        });
        opacity.connect('notify::value', this._follow(ui, 'opacity',
            () => opacity.set_value(Math.round(settings.get_double('opacity') * 100)),
            () => settings.set_double('opacity', opacity.get_value() / 100)));
        tuning.add(opacity);

        return page;
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

        group.add(this._comboRow(ui, {
            key: 'background-mode',
            title: 'Background',
            choices: [
                { value: 'desktop', label: 'Desktop Wallpaper' },
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
            description: 'The patterns are drawn by the GPU, in step with each display.',
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
