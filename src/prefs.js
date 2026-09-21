import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import { EFFECTS, parseEffectIds } from './lib/catalog.js';
import { PALETTE_NAMES } from './lib/palettes.js';

/**
 * The refresh rates the displays are currently running at, for the labels.
 *
 * Prefs is its own process, with no stage and no Clutter views to ask, so this
 * goes to the same place the control centre does. It is decoration: every label
 * reads sensibly without it, and the shell side measures the real rate itself.
 */
function currentRefreshRates() {
    try {
        const reply = Gio.DBus.session.call_sync(
            'org.gnome.Mutter.DisplayConfig',
            '/org/gnome/Mutter/DisplayConfig',
            'org.gnome.Mutter.DisplayConfig',
            'GetCurrentState',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            500,
            null
        );

        const [, monitors] = reply.deepUnpack();
        const rates = [];
        for (const monitor of monitors) {
            const modes = monitor[1];
            for (const mode of modes) {
                const props = mode[6];
                if (!props['is-current']?.deepUnpack()) continue;
                rates.push(mode[3]);
            }
        }
        return rates;
    } catch (e) {
        return [];
    }
}

/** "240 Hz", or "240 Hz and 60 Hz" when the heads disagree. */
function describeRates(rates) {
    const unique = [...new Set(rates.map(hz => Math.round(hz)))].sort((a, b) => b - a);
    if (unique.length === 0) return '';
    if (unique.length === 1) return `${unique[0]} Hz`;
    return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]} Hz`;
}

export default class WallpaperEnginePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 640);
        window.set_search_enabled(true);

        // Rows that mirror a key register here, and the whole lot is dropped when
        // the window closes. Connecting per row and never disconnecting left the
        // settings object holding callbacks that touch destroyed widgets.
        const watchers = [];
        const handlerId = settings.connect('changed', (_s, key) => {
            for (const watcher of watchers) watcher(key);
        });
        window.connect('close-request', () => settings.disconnect(handlerId));

        const state = { window, settings, watch: fn => watchers.push(fn) };

        window.add(this._patternsPage(state));
        window.add(this._backgroundPage(state));
        window.add(this._performancePage(state));
    }

    /**
     * Writes a widget's value back to a key, and follows the key when it is
     * changed elsewhere -- without the write-back firing again on the way in.
     */
    _bind(state, { key, read, write, apply }) {
        let syncing = false;

        const push = () => {
            if (syncing) return;
            write(state.settings, key);
        };

        state.watch(changed => {
            if (changed !== key) return;
            syncing = true;
            try {
                apply(read(state.settings, key));
            } finally {
                syncing = false;
            }
        });

        return push;
    }

    /**
     * A combo row backed by a key, from a list of { value, label } choices.
     *
     * Both directions are guarded. Following the key would otherwise fire the
     * row's own notify::selected and write straight back, and mid-update
     * get_selected() can report Gtk's invalid position -- which read as "no
     * choice", fell through to the first one, and quietly rewrote the key to
     * something the user never picked.
     */
    _comboRow(state, { key, choices, read, write, props }) {
        const { settings } = state;

        const model = new Gtk.StringList();
        for (const choice of choices) model.append(choice.label);

        const indexOf = value => {
            const index = choices.findIndex(c => c.value === value);
            return index < 0 ? 0 : index;
        };

        const row = new Adw.ComboRow({
            ...props,
            model,
            selected: indexOf(read(settings, key)),
        });

        let syncing = false;

        row.connect('notify::selected', () => {
            if (syncing) return;
            const choice = choices[row.get_selected()];
            if (!choice) return;
            write(settings, key, choice.value);
        });

        state.watch(changed => {
            if (changed !== key) return;
            syncing = true;
            try {
                row.set_selected(indexOf(read(settings, key)));
            } finally {
                syncing = false;
            }
        });

        return row;
    }

    // ------------------------------------------------------------------
    // Page 1: Patterns & Effects
    // ------------------------------------------------------------------
    _patternsPage(state) {
        const { settings } = state;
        const page = new Adw.PreferencesPage({
            title: 'Patterns',
            icon_name: 'view-wrapped-symbolic',
        });

        // Group: Active Patterns (Switches for each effect)
        const group = new Adw.PreferencesGroup({
            title: 'Active Patterns',
            description: 'Choose which animated patterns to display. Multiple patterns can be active at the same time to mix and match.',
        });
        page.add(group);

        const enabledSet = new Set(parseEffectIds(settings.get_strv('enabled-effects')));
        const rows = new Map();
        let syncing = false;

        for (const effect of EFFECTS) {
            const row = new Adw.SwitchRow({
                title: effect.title,
                subtitle: effect.desc,
                active: enabledSet.has(effect.id),
            });

            row.connect('notify::active', () => {
                if (syncing) return;
                const current = new Set(parseEffectIds(settings.get_strv('enabled-effects')));
                if (row.active) current.add(effect.id);
                else current.delete(effect.id);
                // Written in catalog order, which is the order they are drawn in.
                settings.set_strv('enabled-effects', EFFECTS.filter(e => current.has(e.id)).map(e => e.id));
            });

            rows.set(effect.id, row);
            group.add(row);
        }

        state.watch(key => {
            if (key !== 'enabled-effects') return;
            const updated = new Set(parseEffectIds(settings.get_strv('enabled-effects')));
            syncing = true;
            try {
                for (const [id, row] of rows) row.active = updated.has(id);
            } finally {
                syncing = false;
            }
        });

        // Group: Tuning
        const tuningGroup = new Adw.PreferencesGroup({
            title: 'Pattern Tuning',
            description: 'Adjust global animation speed and visibility.',
        });
        page.add(tuningGroup);

        const speedRow = new Adw.SpinRow({
            title: 'Animation Speed',
            subtitle: 'Multiplier for movement and particle drift speed (0.25x – 3.0x)',
            adjustment: new Gtk.Adjustment({
                lower: 0.25,
                upper: 3.0,
                step_increment: 0.25,
                value: settings.get_double('speed'),
            }),
            digits: 2,
        });
        const pushSpeed = this._bind(state, {
            key: 'speed',
            read: (s2, k) => s2.get_double(k),
            write: (s2, k) => s2.set_double(k, speedRow.get_value()),
            apply: value => speedRow.set_value(value),
        });
        speedRow.connect('notify::value', pushSpeed);
        tuningGroup.add(speedRow);

        const opacityRow = new Adw.SpinRow({
            title: 'Pattern Opacity (%)',
            subtitle: 'Overall visibility and prominence of the pattern layer',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 100,
                step_increment: 5,
                value: Math.round(settings.get_double('opacity') * 100),
            }),
        });
        const pushOpacity = this._bind(state, {
            key: 'opacity',
            read: (s2, k) => s2.get_double(k),
            write: (s2, k) => s2.set_double(k, opacityRow.get_value() / 100),
            apply: value => opacityRow.set_value(Math.round(value * 100)),
        });
        opacityRow.connect('notify::value', pushOpacity);
        tuningGroup.add(opacityRow);

        return page;
    }

    // ------------------------------------------------------------------
    // Page 2: Background Base
    // ------------------------------------------------------------------
    _backgroundPage(state) {
        const { window, settings } = state;
        const page = new Adw.PreferencesPage({
            title: 'Background',
            icon_name: 'preferences-desktop-wallpaper-symbolic',
        });

        const baseGroup = new Adw.PreferencesGroup({
            title: 'Base Layer',
            description: 'Configure what appears underneath the animated patterns.',
        });
        page.add(baseGroup);

        // Background Mode: desktop | color | image
        const modes = [
            { value: 'desktop', label: 'Desktop Wallpaper (Overlay)' },
            { value: 'color', label: 'Color Gradient' },
            { value: 'image', label: 'Custom Picture' },
        ];

        const modeRow = this._comboRow(state, {
            key: 'background-mode',
            choices: modes,
            read: (s2, k) => s2.get_string(k) || 'desktop',
            write: (s2, k, value) => s2.set_string(k, value),
            props: { title: 'Background Mode' },
        });
        baseGroup.add(modeRow);

        const paletteRow = this._comboRow(state, {
            key: 'color-palette',
            choices: PALETTE_NAMES.map(name => ({ value: name, label: name })),
            read: (s2, k) => s2.get_string(k) || 'Classic Blue',
            write: (s2, k, value) => s2.set_string(k, value),
            props: { title: 'Color Palette', subtitle: 'Color gradient backdrop' },
        });
        baseGroup.add(paletteRow);

        // Custom Picture Selector
        const describeImage = path => path || 'No picture selected';
        const imageRow = new Adw.ActionRow({
            title: 'Custom Picture',
            subtitle: describeImage(settings.get_string('custom-image')),
            sensitive: false, // applyMode() below decides, from the key
        });

        const browseBtn = new Gtk.Button({
            label: 'Browse…',
            valign: Gtk.Align.CENTER,
        });

        browseBtn.connect('clicked', () => {
            const filter = new Gtk.FileFilter({ name: 'Images' });
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/jpeg');
            filter.add_mime_type('image/webp');

            const filters = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filters.append(filter);

            const dialog = new Gtk.FileDialog({
                title: 'Select Wallpaper Image',
                filters,
                default_filter: filter,
                modal: true,
            });

            const current = settings.get_string('custom-image');
            if (current) dialog.set_initial_file(Gio.File.new_for_path(current));

            dialog.open(window, null, (self, result) => {
                let file = null;
                try {
                    file = self.open_finish(result);
                } catch (e) {
                    // Dismissed, or the portal refused -- nothing to report.
                    return;
                }
                const path = file?.get_path();
                if (path) settings.set_string('custom-image', path);
            });
        });
        imageRow.add_suffix(browseBtn);

        const clearBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Clear the chosen picture',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        clearBtn.connect('clicked', () => settings.set_string('custom-image', ''));
        imageRow.add_suffix(clearBtn);
        baseGroup.add(imageRow);

        // What the base layer needs depends on the mode, and the mode can change
        // from the row or from outside, so both go through the key.
        const applyMode = () => {
            const mode = settings.get_string('background-mode') || 'desktop';
            paletteRow.sensitive = mode === 'color';
            imageRow.sensitive = mode === 'image';
        };
        applyMode();

        state.watch(key => {
            if (key === 'background-mode') applyMode();
            else if (key === 'custom-image')
                imageRow.set_subtitle(describeImage(settings.get_string('custom-image')));
        });

        return page;
    }

    // ------------------------------------------------------------------
    // Page 3: Performance & Power
    // ------------------------------------------------------------------
    _performancePage(state) {
        const { settings } = state;
        const page = new Adw.PreferencesPage({
            title: 'Performance',
            icon_name: 'utilities-system-monitor-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Display &amp; Battery',
            description: 'Configure frame rate and power-saving settings.',
        });
        page.add(group);

        // A fixed rate is a rate the display mostly cannot show: 60 frames a
        // second on a 240Hz panel land two or three refreshes apart, which reads
        // as judder however fast the panel is. The first two choices are shares
        // of whatever this display does, so they are smooth on any of them.
        const rates = currentRefreshRates();
        const fastest = rates.length ? Math.max(...rates) : 0;
        const asFps = share => (fastest ? ` — about ${Math.round(fastest / share)} FPS here` : '');

        const fpsRow = this._comboRow(state, {
            key: 'target-fps',
            choices: [
                { value: 0, label: `Match the display — up to every frame it shows${asFps(1)}` },
                { value: -2, label: `Half the display — at most every other frame${asFps(2)}` },
                { value: 60, label: '60 FPS — fixed, whatever the display does' },
                { value: 30, label: '30 FPS — fixed, battery friendly' },
            ],
            read: (s2, k) => {
                const value = s2.get_int(k);
                if (value <= 0) return value <= -2 ? -2 : 0;
                return value >= 45 ? 60 : 30;
            },
            write: (s2, k, value) => s2.set_int(k, value),
            props: {
                title: 'Frame Rate',
                subtitle_lines: 0,
                subtitle: (rates.length
                    ? `Your displays run at ${describeRates(rates)}, and each one is paced separately. `
                    : 'Each display is paced separately against its own refresh rate. ') +
                    'The first two settings give frames back on their own when the shell starts using more CPU than a wallpaper should — lower the render resolution below to buy them back.',
            },
        });
        group.add(fpsRow);

        const budgetRow = this._comboRow(state, {
            key: 'cpu-budget',
            choices: [
                { value: 0.25, label: 'A quarter of a core — lightest' },
                { value: 0.5, label: 'Half a core (recommended)' },
                { value: 0.75, label: 'Three quarters of a core' },
                { value: 0, label: 'No limit — every frame, whatever it costs' },
            ],
            // Doubles never land exactly on the stored value, so snap to the
            // nearest choice rather than falling back to the first one.
            read: (s2, k) => {
                const value = s2.get_double(k);
                if (!(value > 0)) return 0;
                return [0.25, 0.5, 0.75]
                    .reduce((best, o) => Math.abs(o - value) < Math.abs(best - value) ? o : best);
            },
            write: (s2, k, value) => s2.set_double(k, value),
            props: {
                title: 'CPU Budget',
                subtitle: 'How much of one core the patterns may cost while following the display, counting the compositing each repaint causes. Frames are given back when it is exceeded and taken again when there is room — so this is the ceiling, not the cost.',
                subtitle_lines: 0,
            },
        });
        group.add(budgetRow);

        // A fixed rate ignores the budget: it was asked for as a number, and a
        // number is what it gets.
        const applyBudget = () => {
            budgetRow.sensitive = settings.get_int('target-fps') <= 0;
        };
        applyBudget();
        state.watch(k => {
            if (k === 'target-fps') applyBudget();
        });

        const scaleRow = this._comboRow(state, {
            key: 'render-scale',
            choices: [
                { value: 1.0, label: 'Native — every pixel, sharpest, most CPU' },
                { value: 0.75, label: 'High (Recommended) — barely softer, noticeably cheaper' },
                { value: 0.5, label: 'Balanced — half resolution, roughly half the cost' },
                { value: 0.35, label: 'Power Saver — softest, cheapest' },
            ],
            // Doubles never land exactly on the stored value, so snap to the
            // nearest choice rather than falling back to the first one.
            read: (s2, k) => {
                const value = s2.get_double(k) || 0.75;
                return [1.0, 0.75, 0.5, 0.35]
                    .reduce((best, o) => Math.abs(o - value) < Math.abs(best - value) ? o : best);
            },
            write: (s2, k, value) => s2.set_double(k, value),
            props: {
                title: 'Render Resolution',
                subtitle: 'Patterns are drawn at this fraction of the screen and scaled back up by the GPU. The single biggest lever on what a frame costs, so it is also what buys the frame rate back: worth lowering on a 4K or high-refresh display.',
                subtitle_lines: 0,
            },
        });
        group.add(scaleRow);

        // Pause on fullscreen
        const fullscreenRow = new Adw.SwitchRow({
            title: 'Pause on Fullscreen Windows',
            subtitle: 'Stops animation when a fullscreen application or game is active',
            active: settings.get_boolean('pause-on-fullscreen'),
        });
        fullscreenRow.connect('notify::active', () => {
            settings.set_boolean('pause-on-fullscreen', fullscreenRow.active);
        });
        state.watch(k => {
            if (k === 'pause-on-fullscreen') fullscreenRow.active = settings.get_boolean('pause-on-fullscreen');
        });
        group.add(fullscreenRow);

        // Pause on battery
        const batteryRow = new Adw.SwitchRow({
            title: 'Pause on Battery Power',
            subtitle: 'Suspends animation when device is running on battery power',
            active: settings.get_boolean('pause-on-battery'),
        });
        batteryRow.connect('notify::active', () => {
            settings.set_boolean('pause-on-battery', batteryRow.active);
        });
        state.watch(k => {
            if (k === 'pause-on-battery') batteryRow.active = settings.get_boolean('pause-on-battery');
        });
        group.add(batteryRow);

        return page;
    }
}
