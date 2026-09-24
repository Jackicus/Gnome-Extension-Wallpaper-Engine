# Private and deep GNOME Shell API

Wallpaper Engine puts a canvas between the wallpaper and the windows, makes its
base the shell's own wallpaper, and follows both into the overview and the
workspace slide. None of that has a public API. This is everything it reaches
into, for reviewers on extensions.gnome.org and for whoever ports it to the next
GNOME.

Every entry was checked against the GNOME Shell 50.5 JavaScript on the test
machine (extracted from `/usr/lib/gnome-shell/libshell-18.so`) and against the
`45.0`, `47.0`, `49.0` and `51.0` tags of `GNOME/gnome-shell` and `GNOME/mutter`
on gitlab.gnome.org. Unless an entry says otherwise, the field or method exists
with the same meaning in all of them. Line numbers are left out on purpose,
because `src/` is changing; functions are named instead.

## At a glance

| Expression | File | If it changes in a future GNOME | Checked in code |
|---|---|---|---|
| `Main.layoutManager._backgroundGroup` | app.js | No patterns anywhere; the base still shows | Yes, logs a warning |
| `new Background.BackgroundManager(...)._backgroundSource` | background.js | Base modes show the user's own wallpaper | Yes, logs a warning |
| `source._settings` (read, replaced, restored) | background.js | Same | Yes, logs a warning |
| `source._backgrounds`, `background._emitChangedSignal()` | background.js | A new base appears only at the shell's next wallpaper reload | Yes, silently |
| `Main.overview._overview.controls._workspacesDisplay._workspacesViews`, `view._workspaces` | overview.js | Patterns vanish in the overview only | Yes, silently |
| `workspace._background._backgroundGroup`, `._monitorIndex` | overview.js | Same | Yes, silently |
| `Main.overview._overview.controls._thumbnailsBox._thumbnails`, `thumbnail._contents` | overview.js | Patterns vanish from the thumbnail strip only | Yes, silently |
| `Main.wm._workspaceAnimation`, override of `_prepareWorkspaceSwitch` | overview.js | Patterns vanish during a workspace slide only | Yes, silently |
| `this._switchData.monitors`, `strip._monitor`, `strip._workspaceGroups`, `group._background` | overview.js | Same | Yes, silently |
| `class extends Shell.GLSLEffect` | shader.js | `enable()` throws, rolls itself back and the extension shows as errored (below). **Removed in GNOME 51** | No |
| `vfunc_paint_target(node, paintContext)` | shader.js | Patterns freeze on their first frame | No |
| `Shell.SnippetHook` / `Cogl.SnippetHook` | shader.js | The module fails to load | Yes, both tried |

"Silently" means it degrades without a line in the journal, so the symptom is
the only sign.

## The canvas

### `Main.layoutManager._backgroundGroup`

`app.js`, `_build()`:

```js
const group = Main.layoutManager._backgroundGroup;
if (!group) {
    console.warn('[WallpaperEngine] No background group to draw in');
    return;
}
...
group.add_child(renderer.actor);
```

**What for.** The layout manager keeps one `Meta.BackgroundGroup` at the bottom
of `global.window_group` and fills it with a wallpaper actor per monitor.
Parenting each monitor's canvas into it is what puts the patterns over the
wallpaper and under every window, and hides them with the windows when the
overview opens (`layout.js` `_updateVisibility()` hides `global.window_group`
there).

**Why nothing public.** `global.window_group` is public, but it is the windows'
parent; putting an actor at its bottom publicly means
`insert_child_at_index(actor, 1)`, which makes the same assumption (the
background group is child 0) less legibly. `Main.layoutManager.addChrome()` and
its relatives are for panels and sit above the windows.

**If it changes.** No canvas is built, so there are no patterns anywhere,
including in the overview and the slide, which clone the canvas. Everything
else carries on: the base is still the shell's wallpaper, the preferences still
work, and `disable()` still hands the wallpaper back.

**Checked.** Yes, with the warning above, once per build. There is
deliberately no fallback: `global.window_group.add_child()` would append the
canvas above every window, which is worse than no patterns.

## The base (background.js)

Every wallpaper the shell shows comes from a `BackgroundSource`, one per
settings schema, held in a `BackgroundCache` that `ui/background.js` keeps
module-private (`function getBackgroundCache()` is not exported in 45.0, 50.5 or
51.0). The desktop (`layout.js`), each overview workspace (`workspace.js`), each
strip of the workspace slide (`workspaceAnimation.js`) and the unlock dialog all
build a `BackgroundManager` on the default `org.gnome.desktop.background`
schema, so they share one source. So does any other extension that builds one,
which is how the base reaches Blur My Shell's copies. The lock screen still
shows the user's own wallpaper. The extension has no `unlock-dialog` session
mode, so locking disables it, and disabling it hands the wallpaper back.

### `new Background.BackgroundManager({...})._backgroundSource`

`_obtainSource()`:

```js
this._holderContainer = new Clutter.Actor();
...
this._holder = new Background.BackgroundManager({
    container: this._holderContainer,
    monitorIndex: 0,
    controlPosition: false,
});
...
return this._holder._backgroundSource;
```

**What for.** `BackgroundManager` is exported; its `_backgroundSource` field is
the only way to reach the shared source without walking
`Main.layoutManager._bgManagers`. Holding a manager also keeps the source alive:
the cache destroys a source when its use count reaches zero, and the layout
manager destroys and rebuilds all its managers on every `monitors-changed`
(`_updateBackgrounds()`). Without the holder, the swapped settings could be lost
with the source they were put into. The container is a bare `Clutter.Actor`
that is never put on the stage, so the holder's own wallpaper actor is never
painted.

**Why nothing public.** There is no exported way to get a `BackgroundSource`,
or to tell the shell to show a wallpaper other than the one in the user's
settings.

**If it changes.** Caught (next entry): the base modes then show the user's own
wallpaper with the patterns over it. The patterns still draw. Nothing paints a
fallback base; the GPU renderer has no base canvas.

**Checked.** Construction is wrapped:

```js
} catch (e) {
    console.error(`[WallpaperEngine] Could not reach the shell's backgrounds: ${e}`);
    this._holderContainer.destroy();
    this._holderContainer = null;
    return null;
}
```

`release()` destroys the holder and then its container, so nothing built here
outlives `disable()`.

### `source._settings`

`_attach()` and `release()`:

```js
this._shellSettings = source._settings;
this._source = source;
source._settings = this._settings;
reloadBackgrounds(source);
...
source._settings = shellSettings;
reloadBackgrounds(source);
```

**What for.** The source reads `picture-uri` (or `picture-uri-dark`, by the
interface's `color-scheme`) and `picture-options` from `_settings` in
`getBackground()`, and hands the same object to each `Background` it builds,
which reads the colour keys from it and reloads on its `changed` signal. Swapping
in a settings object of our own changes every wallpaper the source serves;
swapping the original back returns the user's wallpaper, including any change
they made meanwhile.

**Why nothing public.** Writing the user's real `org.gnome.desktop.background`
would work through public API, but it would overwrite their wallpaper in dconf,
survive a crash or an uninstall, and fight GNOME Settings. The swap never
touches dconf.

**If it changes.** If the field disappears, the check below fires and the base
modes show the user's wallpaper. If the field stays but stops being read (the
source caching the values at construction, say), the swap succeeds and does
nothing, with no log. The check proves the field exists, not that it is still
used.

**Checked.**

```js
if (!source?._settings) {
    console.warn('[WallpaperEngine] No background source to take over; the base will not change');
    return;
}
```

GNOME 51 makes `Background._loadImage()` async and loads images through a new
`BackgroundTextureCache` (gjs.guide, "Port Extensions to GNOME Shell 51"). At
the `51.0` tag `_settings`, `_backgrounds` and `_emitChangedSignal()` are all
still there, but the loading path under them is new.

### `source._backgrounds` and `background._emitChangedSignal()`

`reloadBackgrounds()`:

```js
const backgrounds = source._backgrounds;
if (!backgrounds) return;

for (const key of Object.keys(backgrounds))
    backgrounds[key]?._emitChangedSignal?.();
```

**What for.** The `Background` objects the source has already built hold the
settings they were built with, so a swap alone changes nothing on screen until
something rebuilds them. `_emitChangedSignal()` is what the shell calls when the
wallpaper setting changes: on an idle it emits `bg-changed`, the source drops
that background, and every `BackgroundManager` holding it builds a new one from
the current `_settings` and crossfades to it. `_backgrounds` is an array used as
a sparse map by monitor index, hence `Object.keys`.

**Why nothing public.** There is no public "reload the wallpaper". Emitting
`bg-changed` directly would depend on one internal name instead of two, but
would lose the idle debounce that folds several changes into one crossfade.

**If it changes.** Nothing is logged. A new base then appears only when the
shell reloads the wallpaper for its own reasons: a monitor change, the user
changing their wallpaper, a light/dark switch. Until then the desktop keeps
showing the previous one.

### A second `Gio.Settings` for `org.gnome.desktop.background`

The constructor:

```js
this._settings = Gio.Settings.new_with_backend(
    BACKGROUND_SCHEMA, Gio.memory_settings_backend_new());
```

Public GIO, but it only makes sense with the swap above. It is the system's own
schema, not a copy, so every key the shell reads exists with its default, in
this version and the next; only a memory backend is behind it, so nothing is
ever written to dconf and the base is gone the moment the shell restarts. `update()` sets
`picture-uri` and `picture-uri-dark` to the same file (so the colour scheme does
not matter), `picture-options`, `primary-color`, `secondary-color` and
`color-shading-type`, between `delay()` and `apply()` so a mode change costs one
crossfade. The gradient files are PNGs in `~/.cache/wallpaper-engine/`, named by
a digest of the stops and size, and never pruned.

## The overview (overview.js)

The overview does not show `global.window_group`. Each workspace preview builds
a wallpaper of its own and clones that workspace's windows over it, so the
patterns are put back the same way: a `Clutter.Clone` of the monitor's canvas in
each preview's own background group, and one in the matching thumbnail.

### `Main.overview._overview?.controls?._workspacesDisplay?._workspacesViews` and `view._workspaces`

`_workspacePreviews()`:

```js
const views = Main.overview._overview?.controls?._workspacesDisplay?._workspacesViews ?? [];
const out = [];
for (const view of views) {
    const inner = view._workspacesView ?? view;
    out.push(...(inner._workspaces ?? (inner._workspace ? [inner._workspace] : [])));
}
```

**What for.** The list of `Workspace` previews on screen, on every monitor.
`_overview` is the `OverviewActor`; `controls` is a public getter on it; the rest
is private. `_workspacesViews` holds a `WorkspacesView` for the primary monitor
and a `SecondaryMonitorDisplay` for each of the others
(`WorkspacesDisplay._updateWorkspacesViews()` in 50.5; the same since GNOME
40). A `SecondaryMonitorDisplay` wraps a view of its own in `_workspacesView`.
That is a `WorkspacesView` (`_workspaces`) or, with workspaces on the primary
monitor only (GNOME's default), an `ExtraWorkspaceView`, which holds a single
`_workspace`. Hence the three-way read. The secondary monitor's preview was
checked showing the patterns in a two-monitor nested shell on 50.5.

**Why nothing public.** The overview exposes no list of its workspace actors.

**If it changes.** Optional chaining turns any missing link into an empty list:
no clones, so the patterns vanish in the overview only (or on the secondary
monitors only, if only the wrapper changes). The base still shows there, since
it is the shell's own wallpaper.

### `workspace._background`, `._backgroundGroup`, `._monitorIndex`

`_attach()`:

```js
const background = workspace._background;
const group = background?._backgroundGroup;
const index = background?._monitorIndex;
if (!group || index === undefined) continue;
```

**What for.** `workspace._background` is the preview's `WorkspaceBackground`;
its `_backgroundGroup` is the `Meta.BackgroundGroup` its wallpaper is in, which
the overview's own scaling and rounded clipping already apply to. The clone goes
in there, inside a `PreviewHost` that reads its allocation back as a scale.
`_monitorIndex` picks the canvas to clone.

**If it changes.** Skipped per preview (the `continue` above): no patterns in
that preview.

**An edge.** The workspace's `BackgroundManager` is built with
`controlPosition: false`, so when the base changes while the overview is open, the
new wallpaper actor is appended above the clone (`_createBackgroundActor()` only
moves it to the bottom when `controlPosition` is true). The patterns in that
preview are covered until the overview is next opened.

### `Main.overview._overview?.controls?._thumbnailsBox?._thumbnails` and `thumbnail._contents`

`_attach()`:

```js
const wsIndex = workspace.metaWorkspace?.index();
const thumbnails = Main.overview._overview?.controls?._thumbnailsBox?._thumbnails ?? [];
const contents = thumbnails[wsIndex]?._contents;
if (contents) { ... contents.add_child(clone); }
```

**What for.** The strip of workspace thumbnails at the top of the overview.
`_contents` is the actor holding a thumbnail's window clones, laid out in stage
coordinates and scaled as a whole, so the canvas clone is placed at
`monitor.x, monitor.y` like the windows beside it. (`metaWorkspace` has no
underscore and is public by convention.)

**If it changes.** No thumbnail clone: patterns vanish from the thumbnail strip
only.

## The workspace slide (overview.js)

### `Main.wm._workspaceAnimation` and the `_prepareWorkspaceSwitch` override

`enable()`:

```js
const animation = Main.wm._workspaceAnimation;
if (animation?._prepareWorkspaceSwitch) {
    const self = this;
    this._injections.overrideMethod(
        Object.getPrototypeOf(animation), '_prepareWorkspaceSwitch',
        original => function (...args) {
            const fresh = !this._switchData;
            original.apply(this, args);
            if (fresh && this._switchData) self._joinSlide(this._switchData);
        });
}
```

**What for.** For the length of a workspace switch (keyboard or swipe), the
`WorkspaceAnimationController` covers the desktop with a strip per monitor, one
workspace group after another, each over a wallpaper of its own, and destroys the
strip when it lands. `_prepareWorkspaceSwitch()` is where the strip is built,
and the only moment it can be joined before it is shown. The override calls the
original first and changes nothing about what it does.

**Why nothing public.** No signal fires when a switch animation starts, and the
strip is never exposed.

**If it changes.** If the method is gone the override is simply not installed:
the patterns vanish while a slide runs and reappear when it lands. If the method
stays and its meaning changes (it stops building the strip, say), `_switchData`
checks below fail quietly with the same result.

**Checked.** `if (animation?._prepareWorkspaceSwitch)`. `InjectionManager.clear()`
in `destroy()` puts the original back. Like any `InjectionManager` user, if
another extension overrides the same method after this one and is disabled
later, this one's `clear()` restores the original under it.

### `this._switchData.monitors`, `strip._monitor`, `strip._workspaceGroups`, `group._background`

`_joinSlide()`:

```js
for (const strip of switchData.monitors ?? []) {
    const index = strip._monitor?.index;
    ...
    for (const group of strip._workspaceGroups ?? []) {
        const wallpaper = group._background?.get_first_child();
        if (wallpaper)
            group._background.insert_child_above(this._cloneOf(source), wallpaper);
    }
}
```

**What for.** `switchData.monitors` are the per-monitor `MonitorGroup` strips,
each with its `_monitor` and its `_workspaceGroups`. The clone goes above each
group's wallpaper and below that workspace's windows.

**The structure differs by version.** In 45 through 49, `group._background` is a
`Meta.BackgroundGroup` whose first child is the wallpaper actor (49 also puts
desktop-window clones in it, after the wallpaper). In 50 and 51 it is a
`WorkspaceBackground`, a new class whose first child is a `Meta.BackgroundGroup`
holding the wallpaper, followed by desktop-window clones. Either way
`get_first_child()` is the wallpaper and the clone lands just above it, under
desktop icons. Only 50 has been seen working.

**If it changes.** Every step is optional-chained or checked, so a change means
no clones: the patterns vanish during the slide only. The clones belong to the
strip and die with it; they are not tracked.

## The renderer (shader.js, engine.js)

### Subclassing `Shell.GLSLEffect`

`buildEffectClass()`:

```js
return GObject.registerClass({
    GTypeName: `WallpaperEngine_${effect.id}_${LOAD}`,
}, class extends Shell.GLSLEffect {
    vfunc_build_pipeline() {
        this.add_glsl_snippet(FRAGMENT, declarations, code, true);
    }
    ...
    setUniform(name, components, values) { ... this.get_uniform_location(name) ... this.set_uniform_float(location, components, values) ... }
});
```

**What for.** Each pattern is a fragment shader. `Shell.GLSLEffect` is the
shell's own way of running one over an actor (the shell's `RadialShaderEffect`
in `lightbox.js` is one), and its `build_pipeline` vfunc, `add_glsl_snippet()`
and the uniform setters are public, introspected API. The shader replaces the
fragment stage (`is_replace` true).

The design leans on one behaviour of it: the shell compiles the pipeline once
per class, on the first instance, and shares it between instances. So there is
one class per pattern, and every monitor's copy of a pattern shares one
compiled program. `Shell.GLSLEffect` is a `Clutter.OffscreenEffect`, so each
layer on each monitor also redirects its (empty) actor into an offscreen texture
of the actor's size before the shader runs over it.

**If it changes.** GNOME 51 removed it (gjs.guide, "Port Extensions to GNOME
Shell 51"; `src/shell-glsl-effect.c` is gone at the `51.0` tag). The replacement
is `Clutter.ShaderEffect` with the snippet returned from
`vfunc_get_static_snippet()`, which mutter 51's `clutter-shader-effect.c` has
and mutter 50's does not, so one zip for 50 and 51 needs two code paths. On 51
as written, `class extends Shell.GLSLEffect` throws when the first pattern is
built, inside `_build()`. That is inside `enable()`, after
`ShellBackground.update()` has taken the wallpaper over. The throw reaches the
shell, which marks the extension as errored and does not call `disable()`: it
only disables an extension whose state is `ACTIVE` (`extensionSystem.js` in
50.5). So `enable()` calls `disable()` itself before rethrowing, and the user's
wallpaper comes back; the extension shows as errored with nothing left on
screen.

**Checked.** No. `metadata.json` does not claim 51.

### Overriding `vfunc_paint_target`

```js
vfunc_paint_target(node, paintContext) {
    this.onPaint?.();
    super.vfunc_paint_target(node, paintContext);
}
```

**What for.** `paint_target` is the `Clutter.OffscreenEffect` vfunc that draws
the offscreen texture through the pipeline, which makes it the last moment
before the frame. `engine.js` sets the time uniforms there, so a pattern shows
the time it is painted rather than the time it was asked for, and books the
next frame from there. A paint that never happens (Clutter culls an actor
nothing can see) books nothing, which is what makes a covered desktop cost
nothing. The signature `(effect, node, paint_context)` is the same in the
`45.0` and `51.0` headers.

**If it changes.** If the signature changed, or the effect stopped painting
through this vfunc, `onPaint` would never run: each pattern would freeze on its
first frame and no timer would be booked. That is a still desktop, idle CPU and
nothing in the log.

### `Shell.SnippetHook` or `Cogl.SnippetHook`

```js
// Shell.SnippetHook moved to Cogl in GNOME 48.
const FRAGMENT = Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;
```

`shell-glsl-effect.h` takes a `ShellSnippetHook` at `45.0` and `47.0` and a
`CoglSnippetHook` from `48.0`. gjs.guide's GNOME 48 port page adds that
`Cogl.SnippetHook` "is exposed in version 45 and later", so the second branch
alone would do on every claimed version. Both are the same enum values.

### GType names registered per load

```js
// Kept for the life of the module, across disable and enable: a class compiles
// its pipeline once, and re-registering it would only leak another. GType names
// last as long as the process, and under a development link this module is
// loaded afresh on every enable, so each load names its classes apart.
const LOAD = GLib.uuid_string_random().slice(0, 8);
const classes = new Map();
```

A GType can never be unregistered, and registering a name twice throws
("Type name ... is already registered"). The classes carry explicit
`GTypeName`s, so each evaluation of `shader.js` gets its own suffix.

- **Installed from the zip** the module is evaluated once per shell process
  (GJS caches modules by URL), so each pattern's class is registered once, the
  first time that pattern is shown, and `classes` keeps it across every
  disable and enable. That module-scope `Map` is deliberately never cleared in
  `disable()`: a cleared map would make the next enable register the same name
  again and throw. A reviewer applying "dynamically stored memory must be cleared
  in disable()" would ask, and the comment above, where the map is declared,
  answers them.
- **Linked for development** the link's entry point,
  `scripts/dev-extension.js`, copies `lib/` somewhere new on every enable, so
  each enable registers a fresh set, and the old ones stay for the life of the
  shell: a small, bounded, development-only leak.

`PreviewHost` in `overview.js` has no explicit name. The shell sets
`GObject.gtypeNameBasedOnJSPath = true` (`ui/environment.js`), so its GType name
comes from the module's path, and a copy at a new path gets a new name.

### `Clutter.Actor.is_in_clone_paint()`

`_onPaint()`:

```js
if (this._timerId || this._paused(layer.actor.is_in_clone_paint())) return;
```

Public and long-standing, present in the `45.0` and `51.0` headers. A paint
through a clone is the overview or the slide, where the patterns show over the
preview's wallpaper whatever windows cover the real desktop, so
`pause-when-covered` must not stop them there.

### `peek_stage_views()` and `Clutter.StageView.get_refresh_rate()`

`_refreshRate()`:

```js
for (const view of this.actor.peek_stage_views() ?? [])
    hz = Math.max(hz, view.get_refresh_rate());
return hz >= 20 ? hz : 60;
```

Public Clutter API, present in mutter 45 and 51. `peek_stage_views()` is the
list of stage views (on Wayland, roughly one per monitor) the actor was last laid
out on. It is empty until the first layout, hence the 60Hz fallback. This is
what paces a 240Hz monitor and a 60Hz one separately. On an X11 session (45 to
49) mutter draws the whole screen as one stage view, so expect every monitor to
pace at one rate there.

## Public, but worth knowing

- **`St.Settings.get().enable_animations`** (system.js). This is not only the
  user's switch. The shell also turns it off with `inhibit_animations()`
  whenever rendering is not hardware-accelerated, a remote-desktop or
  screen-sharing session is active, or an X server has the VNC extension
  (`_shouldEnableAnimations()` in `ui/main.js`, the same at `45.0` and in 50.5).
  In all of those the patterns hold still.
- **`org.gnome.desktop.interface accent-color`** (app.js, prefs.js). This key
  exists from GNOME 47, and both files check for it with
  `settings_schema.has_key('accent-color')` before reading it.
- **UPower and power-profiles-daemon on the system bus** (system.js). These are
  public D-Bus services, and the version notes are in
  [compatibility.md](compatibility.md).
- **`desktopCovered()`** (engine.js) uses `global.display.get_monitor_in_fullscreen()`,
  `Main.layoutManager.getWorkAreaForMonitor()`, `global.get_window_actors()`,
  `Meta.Window.located_on_workspace()` and `get_frame_rect()`. All of them are
  public.

## Not shell internals: the development entry point

`scripts/dev-extension.js`, the entry point `make link` installs, copies `lib/`
into `$XDG_RUNTIME_DIR/wallpaper-engine/` on every enable and imports it from
there, deliberately working around the shell's module cache. It is not in the
zip; the shipped `src/extension.js` imports `./lib/app.js` statically. See
[publishing.md](publishing.md#the-development-path-in-extensionjs).
