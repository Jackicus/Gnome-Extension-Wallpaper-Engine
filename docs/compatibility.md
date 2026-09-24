# Compatibility

`metadata.json` claims GNOME Shell 45 to 50, but one of those has been run.
This page says which, lists every code path that depends on the version, and
says what to check first on each version.

## What has been tested

- **GNOME Shell 50.5** on CachyOS (Arch-based), Wayland, with an NVIDIA GeForce
  GTX 1080 on the proprietary driver 580.178.04. The rest of the stack on that
  machine: mutter 50.5, GJS 1.88.1, GLib 2.88.3, GTK 4.22.5, libadwaita 1.9.4,
  power-profiles-daemon 0.30.
- **The same shell headless and nested** (`make nested`, which runs
  `gnome-shell --wayland --headless --virtual-monitor ...` on its own session
  bus), for screenshots and multi-monitor layouts, including the overview on a
  second monitor.

Both of those mostly ran the development link, whose entry point is
`scripts/dev-extension.js`. The shipped `src/extension.js` runs only from a real
install; it has been run once that way on 50.5, from a plain copy of `src/` in
the nested shell, through three disable/enable cycles. Install the zip before
trusting any other version (checklist step 4).

Nothing else has been tested:

- **GNOME 45, 46, 47, 48 and 49** are claimed and have never been run.
- **GNOME 51** (tagged 51.0 on 2026-09-14) is not claimed, and it will not
  work: it removed `Shell.GLSLEffect`, which draws every pattern.
- **No Mesa GPU** (AMD, Intel), no GLES2-only GPU, no virtual machine.
- **No X11 session.** 45 to 48 have one, 49 turns it off by default, and 50
  removed it (gjs.guide, "Port Extensions to GNOME Shell 49" and "... 50").

## Version-sensitive code paths

### The snippet hook (shader.js)

```js
const FRAGMENT = Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;
```

`Shell.GLSLEffect.add_glsl_snippet()` takes a `Shell.SnippetHook` up to 47 and a
`Cogl.SnippetHook` from 48 (`src/shell-glsl-effect.h` at the gnome-shell tags
`47.0` and `48.0`). gjs.guide's GNOME 48 port page says `Cogl.SnippetHook` "is
exposed in version 45 and later", so the fallback should hold on every claimed
version. 45 to 47 take the first branch and 48 onwards the second.

*Check first on 45 and 47:* each pattern draws, and the journal has no
`TypeError` from `shader.js`.

### `Shell.GLSLEffect` itself (shader.js)

It is present from 45 to 50 and removed in 51 (gjs.guide, "Port Extensions to
GNOME Shell 51"; `src/shell-glsl-effect.c` is absent at the `51.0` tag). The
replacement is `Clutter.ShaderEffect`, with the snippet returned from
`vfunc_get_static_snippet()`. Mutter 51's `clutter-shader-effect.c` has that
vfunc and mutter 50's does not, so supporting 50 and 51 means two code paths or
two releases. Every other private path in
[private-api.md](private-api.md) is still there at `51.0`, so this is the one
blocker for 51.

### GLSL dialects (shader.js, `make check`)

Cogl wraps each snippet in its own boilerplate and compiles it against the
driver, in a dialect that depends on mutter's version and on which of its
drivers is in use:

| mutter | desktop GL driver | GLES2 driver |
|---|---|---|
| 45, 46 | GLSL 1.20 (`#version 120`), GL 2.1 or later | GLSL ES 1.00 |
| 47 to 50 | GLSL 1.40, GL 3.1 or later | GLSL ES 1.00 |

(From `cogl/cogl/driver/gl/gl/cogl-driver-gl.c` at `45.0`, `46.0` and `47.0`,
`gl3/cogl-driver-gl3.c` at `48.0` and `50.0`, and the `gles`/`gles2` drivers
beside them.) On GLES, Cogl's fragment boilerplate starts with `precision highp
float;` (`cogl-glsl-shader-boilerplate.h`).

`make check` compiles every pattern with `glslangValidator` as GLSL 1.10, GLSL
3.30 and GLSL ES 1.00 (`DIALECTS` in `scripts/shaders.mjs`). Those are not the
two desktop versions Cogl uses, but they bracket them. 1.10 is stricter than
1.20 (it has no implicit int-to-float conversion), 3.30 reserves every keyword
1.40 does, and ES 1.00 is the GLES dialect itself. So a shader that passes all
three should pass Cogl's front end on every version above. Adding `GLSL 1.20`
and `GLSL 1.40` to `DIALECTS` would make it test the exact versions.

What `make check` cannot tell you:

- **What a particular driver accepts or miscompiles.** The only compiler the
  shaders have met is NVIDIA's, and NVIDIA accepts more than the specification
  does. Mesa is the first thing to try.
- **GLES2 GPUs with no `highp` in the fragment stage** (the Mali-400/450
  class). Cogl's own `precision highp float;` fails there, so nothing draws.
  Even where it compiles, the hashes and the `u_epoch`/`u_time` split assume
  32-bit floats.
- **Cost.** `make bench` times each shader on this GPU only.

A pattern whose shader fails to compile in the shell draws nothing, and the
driver's compile log goes to the journal, not to a terminal.

*Check first on 45 and 46 (GLSL 1.20), and on any Mesa machine:* switch on
every pattern, then read `make logs '5 min ago'` and the full journal for Cogl
shader warnings.

### The workspace slide (overview.js)

`group._background` changed shape in 50. In 45 to 49 it is a
`Meta.BackgroundGroup` whose first child is the wallpaper; in 50 and 51 it is a
`WorkspaceBackground` whose first child is a `Meta.BackgroundGroup`. The clone
goes above `get_first_child()` in both cases, which is above the wallpaper either
way, but only 50 has been seen working.

*Check first on 49 and earlier:* switch workspaces with Super+Page Down and with
a touchpad swipe. The patterns should travel with the workspace rather than
blink back when it lands.

### The overview (overview.js)

The paths into the workspace previews and the thumbnail strip are unchanged
from `45.0` to `51.0`, including the `SecondaryMonitorDisplay._workspacesView`
wrapper that secondary monitors are reached through (see
[private-api.md](private-api.md)). Only 50.5 has been seen, with two monitors.

*Check first:* open the overview. The patterns should be in the workspace
preview and in the thumbnails, on each monitor.

### The base (background.js)

`BackgroundManager._backgroundSource`, `BackgroundSource._settings`,
`BackgroundSource._backgrounds` and `Background._emitChangedSignal()` are present
from `45.0` to `51.0`. GNOME 51 moves image loading to an async
`_loadImage()` and a new `BackgroundTextureCache`, so the loading underneath the
swap is new there even though the fields are not.

*Check first:* go through every base mode, switch the extension off in each,
and confirm the user's own wallpaper comes back. A `No background source to take
over` line in the journal means the takeover failed.

### Accent Color mode (app.js, prefs.js, palettes.js)

The `accent` mode follows `org.gnome.desktop.interface accent-color`, which
GNOME 47 added (gjs.guide, "Port Extensions to GNOME Shell 47"). Both processes
check for the key rather than for a shell version:

```js
this._hasAccent = this._interface.settings_schema.has_key('accent-color');
...
accent: this._hasAccent ? this._interface.get_string('accent-color') : 'blue',
```

On 45 and 46 the mode is still offered, labelled "Accent Color (Blue)" in the
preferences, and draws GNOME's default blue (`ACCENTS.blue` in `palettes.js`),
which never changes. Reading the key without that check would not crash the
shell: GJS throws instead (on GJS 1.88 here, `Error: GSettings key ... not found
in schema org.gnome.desktop.interface`), and `enable()` would fail -- rolling
itself back, but leaving no patterns. The `changed::accent-color` handler is
only connected when the key exists.

*Check first on 46:* choosing the mode gives a blue gradient and nothing in the
journal. *On 47 and later:* change the accent in Settings, Appearance, and the
base should crossfade.

### Pausing in power-saver (system.js)

This path asks power-profiles-daemon for `ActiveProfile`. It tries the new bus
name first and falls back to the old one when nobody owns the new one:

```js
const PROFILES = [
    ['org.freedesktop.UPower.PowerProfiles', '/org/freedesktop/UPower/PowerProfiles'],
    ['net.hadess.PowerProfiles', '/net/hadess/PowerProfiles'],
]...
if (proxy.g_name_owner === null && index + 1 < PROFILES.length) { ... this._watchProfiles(index + 1); }
```

- power-profiles-daemon **0.20** moved under the UPower project and began
  answering to `org.freedesktop.UPower.PowerProfiles` "in addition to the
  previous `net.hadess.PowerProfiles` for compatibility reasons" (its `NEWS`).
  On this machine, 0.30 owns both names.
- GNOME Shell's own power-mode menu moved to the new name in **48**:
  `BUS_NAME` in `js/ui/status/powerProfiles.js` is `net.hadess.PowerProfiles` at
  `45.0`, `46.0` and `47.0`, and `org.freedesktop.UPower.PowerProfiles` from
  `48.0`.
- The daemon's version does not follow the shell's, so the fallback matters on
  any system with a daemon older than 0.20, which is most likely alongside 45
  and 46.
- Fedora 41 replaced the daemon with **tuned-ppd**, which implements the same
  API. It began with the old name only; tuned issue #683 (September 2024) asked
  for the UPower name as well. That is the other case the fallback exists for.
  It is untested.
- Proxies are built with `DO_NOT_AUTO_START`, so a machine without the daemon
  logs nothing and never pauses for this reason.

*Check first:* run `powerprofilesctl set power-saver` and the patterns should
stop. Run `powerprofilesctl set balanced` and they start again on the next
repaint of the desktop.

### Pausing while animations are off (system.js)

This path follows `St.Settings.get().enable_animations` and its
`notify::enable-animations`, which are present in 45 to 51. That property is
false when the user turns animations off
(`org.gnome.desktop.interface enable-animations`), and also whenever the shell
inhibits animations itself: when rendering is not hardware-accelerated, while a
remote-desktop or screen-sharing session is running, or on an X server with the
VNC extension (`_shouldEnableAnimations()` in `ui/main.js`, the same at `45.0`
and in 50.5). So the patterns are still in a virtual machine without 3D
acceleration, which is worth saying in the description, since reviewers often
test in one ([publishing.md](publishing.md)).

GNOME 51 adds `St.Settings` `reduced-motion` and moves the shell's own
animations to it (gjs.guide, "Port Extensions to GNOME Shell 51"). A port to 51
should decide whether reduced motion pauses the patterns too.

*Check first:* set `org.gnome.desktop.interface enable-animations` to false and
the patterns should stop. Set it back and they resume.

### The preferences (prefs.js)

The preferences run in a separate process on whatever GTK and libadwaita the
system has; GNOME Shell does not pin a minimum. GNOME 45 was released with GTK
4.12 and libadwaita 1.4. Versions below are the ones marked in this machine's
`Adw-1.gir` and `Gtk-4.0.gir`.

| Widget or call | Needs | In GNOME 45's stack |
|---|---|---|
| `Adw.ComboRow`, `Adw.ActionRow` (incl. `subtitle_lines`), `Adw.PreferencesPage`, `Adw.PreferencesGroup` | libadwaita 1.0 | yes |
| `Adw.ExpanderRow`, `add_row()` | libadwaita 1.0 | yes |
| `Adw.ExpanderRow.add_suffix()` (the pattern's on/off switch) | libadwaita 1.4; before it, the now-deprecated `add_action()` | yes |
| `Adw.EntryRow`, `show_apply_button`, the `apply` signal | libadwaita 1.2 | yes |
| `Adw.SpinRow` | libadwaita 1.4 | yes |
| `Adw.SwitchRow` | libadwaita 1.4 | yes |
| `Gtk.FileDialog` (`open()`/`open_finish()`, `filters`, `default_filter`, `set_initial_file()`) | GTK 4.10 | yes |
| `Gtk.StringList`, `Gtk.Adjustment`, `Gtk.Switch`, `Gtk.FileFilter` | GTK 4.0 | yes |

Nothing used needs more than libadwaita 1.4. The things to keep out, if 45 stays
claimed, are libadwaita 1.5 and later (`Adw.PreferencesDialog`,
`Adw.AlertDialog` and `Adw.Dialog` from 1.5; `Adw.ButtonRow` and
`ComboRow.header_factory` from 1.6). From 47 the shell awaits
`fillPreferencesWindow()` (gjs.guide, 47 port page), and a synchronous one is
fine.

*Check first on 45:* open the preferences and go through every page. Browse...
should open the file chooser, and you should be able to save and delete a scene.

### Smaller things

- **`enable()` and `disable()` are synchronous** in the shipped
  `src/extension.js`. Only the development entry point,
  `scripts/dev-extension.js`, has an `async enable()`. The shell awaits
  `enable()` from 45 onward (`extensionSystem.js`,
  `await extension.stateObj.enable()` at `45.0` and in 50.5), so both work.
  GNOME 51 throws if `disable()` is async; neither one's is.
- **Refresh rate per monitor** (engine.js) comes from `peek_stage_views()`.
  On X11 mutter uses one stage view for the whole screen, so expect every monitor
  to pace at the same rate there.
- **`Gio.DBus.makeProxyWrapper()`** returns a `Gio.DBusProxy` subclass in 51
  and must be called with `new` (gjs.guide, 51 port page). `system.js` already
  calls it that way.

## Checklist for a new GNOME version

1. Read gjs.guide's "Port Extensions to GNOME Shell N" page and search it for
   `GLSLEffect`, `ShaderEffect`, `SnippetHook`, `background`, `workspaceAnimation`,
   `overview`, `St.Settings` and `makeProxyWrapper`.
2. Diff the shell between the last working tag and the new one, over the files
   [private-api.md](private-api.md) reaches into:
   `js/ui/{background,layout,workspace,workspacesView,workspaceThumbnail,workspaceAnimation,overview,overviewControls,main}.js`
   and `src/shell-glsl-effect.h`. Search for every name in its table.
3. Check Cogl's GLSL version for the new mutter (the driver files above). If it
   changed, add it to `DIALECTS`, then run `make check`.
4. Install the zip rather than the development link: `make uninstall`, then
   `make zip`, then
   `gnome-extensions install dist/wallpaper-engine@jackt.shell-extension.zip`,
   then log out and in. This tests what users get: the shipped
   `src/extension.js`, the schema compiled on install, and `lib/` imported in
   place. `make link` puts the link back afterwards. **Do not use
   `install --force` over the link.** It removes the existing directory with
   `file_delete_recursively()` (extensions-tool `main.c`), which enumerates
   without `NOFOLLOW_SYMLINKS`, so it follows the `lib` and `schemas` links and
   deletes what is in them in `src/`. `make uninstall` removes only the links.
5. `make logs '10 min ago'` should show no `TypeError`, no `No background
   source`, and no Cogl shader warnings.
6. Switch each pattern on alone, then all of them together.
7. Go through every base mode, and switch the extension off in each. The user's
   wallpaper must come back.
8. Open the overview. The patterns should be in the workspace previews and the
   thumbnails, on every monitor.
9. Switch workspaces with the keyboard and with a touchpad swipe.
10. Lock and unlock the screen.
11. Test each pause: a fullscreen window, maximized windows, power-saver,
    animations off, and battery on a laptop.
12. Open the preferences, go through every page, choose a picture, and save
    and delete a scene.
13. With two monitors, turn `span-monitors` on and off, and plug and unplug a
    monitor while the extension is enabled.
14. Disable and enable ten times, then watch `make logs` and the shell's CPU
    use while everything is paused.
15. Only then add the version to `shell-version`.
