import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { EFFECTS, parseEffectIds } from './lib/catalog.js';
import { PALETTE_NAMES } from './lib/palettes.js';

export default class WallpaperEnginePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 640);
        window.set_search_enabled(true);

        const state = { window, settings };

        window.add(this._patternsPage(state));
        window.add(this._backgroundPage(state));
        window.add(this._performancePage(state));
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

        let enabledSet = new Set(parseEffectIds(settings.get_strv('enabled-effects')));

        for (const effect of EFFECTS) {
            const row = new Adw.SwitchRow({
                title: effect.title,
                subtitle: effect.desc,
                active: enabledSet.has(effect.id),
            });

            row.connect('notify::active', () => {
                const current = new Set(parseEffectIds(settings.get_strv('enabled-effects')));
                if (row.active) {
                    current.add(effect.id);
                } else {
                    current.delete(effect.id);
                }
                settings.set_strv('enabled-effects', [...current]);
            });

            // Update row if settings change externally
            settings.connect('changed::enabled-effects', () => {
                const updated = new Set(parseEffectIds(settings.get_strv('enabled-effects')));
                if (row.active !== updated.has(effect.id)) {
                    row.active = updated.has(effect.id);
                }
            });

            group.add(row);
        }

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
        speedRow.connect('changed', () => {
            settings.set_double('speed', speedRow.get_value());
        });
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
        opacityRow.connect('changed', () => {
            settings.set_double('opacity', opacityRow.get_value() / 100);
        });
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
            { key: 'desktop', label: 'Desktop Wallpaper (Overlay)', subtitle: 'Draw patterns directly over your current GNOME wallpaper' },
            { key: 'color', label: 'Color Gradient', subtitle: 'Draw patterns over a styled color palette backdrop' },
            { key: 'image', label: 'Custom Picture', subtitle: 'Draw patterns over a chosen image file' },
        ];

        const modeModel = new Gtk.StringList();
        for (const m of modes) modeModel.append(m.label);

        const currentMode = settings.get_string('background-mode') || 'desktop';
        let initialModeIndex = modes.findIndex(m => m.key === currentMode);
        if (initialModeIndex < 0) initialModeIndex = 0;

        const modeRow = new Adw.ComboRow({
            title: 'Background Mode',
            model: modeModel,
            selected: initialModeIndex,
        });
        baseGroup.add(modeRow);

        // Color Palette Selector
        const paletteModel = new Gtk.StringList();
        for (const name of PALETTE_NAMES) paletteModel.append(name);

        const currentPalette = settings.get_string('color-palette') || 'Classic Blue';
        let initialPaletteIndex = PALETTE_NAMES.indexOf(currentPalette);
        if (initialPaletteIndex < 0) initialPaletteIndex = 0;

        const paletteRow = new Adw.ComboRow({
            title: 'Color Palette',
            subtitle: 'Color gradient backdrop',
            model: paletteModel,
            selected: initialPaletteIndex,
            sensitive: currentMode === 'color',
        });
        paletteRow.connect('notify::selected', () => {
            const chosen = PALETTE_NAMES[paletteRow.get_selected()];
            if (chosen) settings.set_string('color-palette', chosen);
        });
        baseGroup.add(paletteRow);

        // Custom Picture Selector
        const imageRow = new Adw.ActionRow({
            title: 'Custom Picture',
            subtitle: settings.get_string('custom-image') || 'No picture selected',
            sensitive: currentMode === 'image',
        });

        const browseBtn = new Gtk.Button({
            label: 'Browse…',
            valign: Gtk.Align.CENTER,
        });

        browseBtn.connect('clicked', () => {
            const chooser = new Gtk.FileChooserNative({
                title: 'Select Wallpaper Image',
                transient_for: window,
                action: Gtk.FileChooserAction.OPEN,
                accept_label: 'Select',
                cancel_label: 'Cancel',
            });

            const filter = new Gtk.FileFilter();
            filter.set_name('Images (*.png, *.jpg, *.jpeg, *.webp)');
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/jpeg');
            filter.add_mime_type('image/webp');
            chooser.add_filter(filter);

            chooser.connect('response', (dialog, response_id) => {
                if (response_id === Gtk.ResponseType.ACCEPT) {
                    const file = chooser.get_file();
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('custom-image', path);
                        imageRow.set_subtitle(path);
                    }
                }
                chooser.destroy();
            });

            chooser.show();
        });
        imageRow.add_suffix(browseBtn);
        baseGroup.add(imageRow);

        // Mode row change handler
        modeRow.connect('notify::selected', () => {
            const selectedMode = modes[modeRow.get_selected()]?.key || 'desktop';
            settings.set_string('background-mode', selectedMode);
            paletteRow.sensitive = (selectedMode === 'color');
            imageRow.sensitive = (selectedMode === 'image');
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

        // Frame rate
        const fpsOptions = [
            { fps: 30, label: '30 FPS (Recommended — smooth & battery efficient)' },
            { fps: 60, label: '60 FPS (Maximum smoothness)' },
        ];
        const fpsModel = new Gtk.StringList();
        for (const opt of fpsOptions) fpsModel.append(opt.label);

        const currentFps = settings.get_int('target-fps') || 30;
        const initialFpsIndex = currentFps === 60 ? 1 : 0;

        const fpsRow = new Adw.ComboRow({
            title: 'Target Frame Rate',
            model: fpsModel,
            selected: initialFpsIndex,
        });
        fpsRow.connect('notify::selected', () => {
            const chosen = fpsOptions[fpsRow.get_selected()]?.fps || 30;
            settings.set_int('target-fps', chosen);
        });
        group.add(fpsRow);

        // Render resolution
        const scaleOptions = [
            { scale: 1.0, label: 'Full — sharpest, most CPU' },
            { scale: 0.75, label: 'High (Recommended) — barely softer, noticeably cheaper' },
            { scale: 0.5, label: 'Balanced — half resolution, roughly half the cost' },
            { scale: 0.35, label: 'Power Saver — softest, cheapest' },
        ];
        const scaleModel = new Gtk.StringList();
        for (const opt of scaleOptions) scaleModel.append(opt.label);

        const currentScale = settings.get_double('render-scale') || 1.0;
        let initialScaleIndex = scaleOptions.findIndex(o => Math.abs(o.scale - currentScale) < 0.01);
        if (initialScaleIndex < 0) initialScaleIndex = 1;

        const scaleRow = new Adw.ComboRow({
            title: 'Render Resolution',
            subtitle: 'Patterns are drawn at this fraction of the screen and scaled back up by the GPU. The single biggest lever on CPU use — worth lowering on a 4K display.',
            model: scaleModel,
            selected: initialScaleIndex,
        });
        scaleRow.connect('notify::selected', () => {
            const chosen = scaleOptions[scaleRow.get_selected()]?.scale || 1.0;
            settings.set_double('render-scale', chosen);
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
        group.add(batteryRow);

        return page;
    }
}
