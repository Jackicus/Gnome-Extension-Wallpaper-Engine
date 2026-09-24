# Publishing to extensions.gnome.org

How to build the upload, what goes in it, and how the extension stands against
the EGO review guidelines. Web sources are named where they are used; the
guidelines are gjs.guide's
[Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
and [Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html),
as fetched on 2026-09-24.

## Building the zip

```sh
make zip
```

This runs `scripts/dev.sh pack`, which:

1. runs `gnome-extensions pack src --extra-source=lib --out-dir=dist --force`.
   `gnome-extensions` adds `extension.js`, `metadata.json`, `prefs.js` and every
   `schemas/*.gschema.xml` by itself (`command-pack.c`); `lib/`, with `layers/`
   under it, has to be named. A `LICENSE` or `COPYING` at the top of the repo is
   added too, if one exists;
2. deletes `schemas/gschemas.compiled` from the zip if the `gnome-extensions`
   doing the packing put one there. Up to GNOME 45 it compiled the schema into the
   bundle; from 46 it does not (`command-pack.c` at the `45.0` and `46.0` tags);
3. checks that the zip holds exactly what should ship, which is every `.js` file
   under `src/lib`, the two entry points, `metadata.json` and the schema XML, and
   nothing else. A missing module or a stray file (an editor backup, a note) stops
   the build with the file named;
4. prints the listing. The output is `dist/wallpaper-engine@jackt.shell-extension.zip`.

What it contains today:

```
metadata.json
extension.js
prefs.js
schemas/org.gnome.shell.extensions.wallpaper-engine.gschema.xml
lib/app.js  lib/background.js  lib/catalog.js  lib/engine.js  lib/layer.js
lib/overview.js  lib/palettes.js  lib/scenes.js  lib/shader.js  lib/system.js
lib/layers/{aurora,bokeh,constellation,contours,embers,fireflies,nebula,
            rain,snow,sparkles,starfield,wave}.js
```

What it leaves out: `src/schemas/gschemas.compiled` (a local artefact of
`make link`/`make reload`), `scripts/` (including `scripts/dev-extension.js`, the
development entry point), `docs/`, `README.md`, `CLAUDE.md`, `.claude/` and the
screenshots. A new layer file is picked up without changes
here, because the whole of `lib/` is packed.

### Why the schema ships as XML only

- gjs.guide, [Port Extensions to GNOME Shell 44](https://gjs.guide/extensions/upgrading/gnome-shell-44.html):
  "GNOME Shell 44 can compile the GSettings Schemas file(s) while installing the
  extension package. ... you MUST only include the
  schemas/org.gnome.shell.extensions.<schema-id>.gschema.xml file(s) and avoid
  shipping the gschemas.compiled in the package (if your extension is only
  supporting GNOME Shell 44 and later)."
- gjs.guide, [Preferences](https://gjs.guide/extensions/development/preferences.html):
  "As of GNOME 44, settings schemas are compiled automatically for extensions
  installed with the gnome-extensions tool, GNOME Extensions website, or a
  compatible application like Extension Manager."
- The review guidelines' own GSettings rule asks only that "The Schema XML file
  MUST be included in the extension ZIP file".
- In the shell, `extensionDownloader.js` runs
  `glib-compile-schemas --strict <extension>/schemas` after unzipping an EGO
  download (both at `45.0` and in 50.5). `--strict` means a schema warning is
  an install failure, so run `glib-compile-schemas --strict --dry-run src/schemas`
  before uploading.

Every claimed version (45 and later) compiles on install, so the zip carries no
compiled schema.

### Testing the zip before uploading

```sh
make uninstall
make zip
gnome-extensions install dist/wallpaper-engine@jackt.shell-extension.zip
# log out and back in, then enable it
```

Do this over `make uninstall`, not with `install --force` over the development
link. `--force` deletes the existing directory recursively *through* its
symlinks, which empties `src/lib` and `src/schemas` (see
[compatibility.md](compatibility.md), checklist step 4). `make link` restores
the link afterwards. This is also the only way to run the shipped
`src/extension.js`: the link's entry point is `scripts/dev-extension.js`.

## metadata.json

| Key | Now | Verdict |
|---|---|---|
| `uuid` | `wallpaper-engine@jackt` | Valid characters and not `gnome.org`. It is the extension's identity on EGO and cannot change after the first upload |
| `name` | `Wallpaper Engine` | See [the name](#copyrights-and-trademarks-the-name) |
| `description` | one line | Should say more (below) |
| `shell-version` | 45 to 50 | All released, so allowed, but only 50 is tested |
| `settings-schema` | set | Correct; `getSettings()` is called without arguments, which is what Best Practices asks |
| `url` | GitHub repo | Correct |
| `version` | absent | Correct: "This field SHOULD NOT be set by extension developers" ([Anatomy](https://gjs.guide/extensions/overview/anatomy.html)); EGO assigns it |
| `version-name` | absent | Worth adding |
| `session-modes` | absent | Correct ("MUST be dropped if you are only using `user` mode") |
| `donations`, `gettext-domain` | absent | Correct. The schema's `gettext-domain="wallpaper-engine"` attribute is unused and harmless |

**`version-name`** is the version users see; without it EGO shows its own
counter. From the Anatomy page it "MUST be a string that only contains letters,
numbers, space and period with a length between 1 and 16 characters",
matching `/^(?!^[. ]+$)[a-zA-Z0-9 .]{1,16}$/`. So `"1.0"` or `"1.0 beta"` is
fine, but `"v1.0-beta"` is not, because of the dash. Recommendation: add
`"version-name": "1.0"` and bump it with each upload.

**`shell-version`**: the guideline is that it "MUST only contain stable releases
and up to one development release. Extensions must not claim to support future
GNOME Shell versions." 45 to 50 are all released, so the list is allowed. It is
also a promise: "if an extension is tested and found to be fundamentally broken
it will be rejected". The safest first upload claims what has been run (50).
Add versions as they pass the checklist in [compatibility.md](compatibility.md);
a new upload can widen the list. GNOME 51 needs the renderer ported off
`Shell.GLSLEffect` first.

**`description`** is the only place a user or reviewer learns about behaviour
that could look like a bug. Worth saying:

- in the Accent, Color and Custom Picture modes it replaces the wallpaper
  the shell shows (the desktop, the overview, and extensions that blur it)
  without changing the user's wallpaper setting;
- it stays still when animations are off. GNOME also turns animations off in
  virtual machines without 3D acceleration and during remote-desktop sessions;
- it stays still in power-saver, and optionally on battery;
- gradients are cached as images in `~/.cache/wallpaper-engine`.

## The review guidelines, item by item

### Only use initialization for static resources: meets

`src/extension.js` has no constructor and imports `./lib/app.js` statically, so
the module scope of everything under `lib/` runs when the extension is loaded,
before `enable()`. All of it is definitions: the `PreviewHost` class, the
D-Bus interfaces from `makeProxyWrapper()` in `system.js`, the catalog and its
shader strings, the `LOAD` string and an empty `Map` in `shader.js`, and a
`Set` of key names in `app.js`. Nothing is instantiated, connected or scheduled.
That is what the guideline allows ("static data structures and instances of
built-in JavaScript objects"). `WallpaperEngineApp` calls `getSettings()` in its
constructor, but it is constructed inside `enable()`.

### Destroy all objects: meets

`disable()` tears down, in order: the layout-manager, settings and interface
signal connections; the overview clones and the slide override
(`InjectionManager.clear()`); `SystemState` (its `Gio.Cancellable` is cancelled
and its D-Bus proxies and `St.Settings` connection are dropped); the wallpaper
takeover, including the holder `BackgroundManager` and its container actor; and
every `MonitorRenderer` (its timer, then its actor and every layer and effect
under it). It uses `?.` on the parts `enable()` builds, so it also gets through a
partial enable and always hands the wallpaper back.

`shader.js` keeps registered classes in a module-scope `Map` across
`disable()`, on purpose, because GTypes cannot be unregistered. A comment where
the map is declared says so, which answers the reviewer who applies "all
dynamically stored memory must be cleared or freed in disable()".

If `enable()` throws, the shell does not call `disable()`: it marks the
extension as errored and only disables an extension whose state is `ACTIVE`
(`extensionSystem.js` in 50.5). So `enable()` wraps its body, calls `disable()`
itself on a throw, and rethrows -- the wallpaper is handed back and the shell
still sees the error. With `_backgroundGroup` checked, the known way to get
there is a GNOME without `Shell.GLSLEffect`, which is not claimed.

### Disconnect all signals: meets

Every connection uses `connectObject()`/`disconnectObject()` and is dropped in
the owner's `destroy()`/`disable()`. The `destroy` handlers on overview clones
are on the clones themselves. The preferences disconnect their one settings
handler on `close-request`.

### Remove main loop sources: meets

There is one source per monitor: `GLib.timeout_add()` in
`MonitorRenderer._onPaint()`, guarded by `if (this._timerId || ...) return;` on
the line before it is created, and removed in `MonitorRenderer.destroy()`.
Nothing else adds one.

### Do not use deprecated modules: meets

There is no `ByteArray`, `Lang` or `Mainloop`, and no `run_dispose()`.

### No GTK in the shell, no shell libraries in the preferences: meets

The shell side imports Gio, GLib, GObject, GDesktopEnums, Clutter, Cogl, Meta,
Shell, St and cairo, and no Gtk, Gdk or Adw. `prefs.js` imports Adw, Gtk, Gio
and GLib, plus `lib/catalog.js` (the layers and `lib/layer.js`, all pure JS),
`lib/palettes.js` (cairo) and `lib/scenes.js` (GLib), none of which imports
Clutter, Meta, St or Shell. Best Practices suggests keeping modules used only by
the preferences in a `prefs/` directory. `scenes.js` is one, so moving it is
optional tidying.

### Avoid interfering with the extension system: meets

The code that works around the shell's module cache is the development entry
point, `scripts/dev-extension.js`, and it is not in the zip. See
[the development path in extension.js](#the-development-path-in-extensionjs).

### Code must not be obfuscated: meets

This is plain ES modules, unminified.

### No excessive logging: meets

The shipped code logs nothing on a good enable, a lock or an unlock. Every
`console.warn`/`console.error` is on a failure path: no background group, no
background source, a gradient that could not be rendered, a D-Bus service that
answered with an error. The only informational line, `Enabled from ...`, is in
`scripts/dev-extension.js`, which does not ship.

### Scripts and binaries, clipboard, privileged subprocesses, telemetry: meets

None of these are used. `scripts/` is not in the zip.

### Extensions must be functional: a risk worth knowing

Reviewers often run a virtual machine. Without 3D acceleration the shell
inhibits animations (`_shouldEnableAnimations()` in `ui/main.js`), and
`system.js` pauses the patterns whenever `St.Settings` `enable-animations` is
false. A reviewer in such a VM sees still patterns, or none, and may report it
as broken. Say so in the description.

### Extensions must not be AI-generated: know the code

The rule is that the developer "should be able to justify and explain the code
they submit", and submissions with "large amounts of unnecessary code,
inconsistent code style, imaginary API usage, comments serving as LLM prompts,
or other indications of AI-generated output will be rejected". Best Practices
lists the patterns reviewers look for. In this code:

- **Optional chaining on guaranteed APIs** ("Avoid Unnecessary Checks"): the
  ones called out before (`global.display?.get_n_monitors?.()`,
  `error.matches?.()`) are gone. What is left is on private shell paths, where
  it is how they degrade and [private-api.md](private-api.md) explains each; on
  the parts of `WallpaperEngineApp` that `disable()` may find missing; and
  `workspace.metaWorkspace?.index()` in `overview.js`, where `metaWorkspace`
  is null for a monitor's extra workspace view.
- **try/catch that only swallows** ("Avoid Unnecessary try-catch Wrappers"):
  gone from the shipped `extension.js`, so a failed load shows as an error in
  the Extensions app. Those that remain handle real failures: rendering a
  gradient, reaching the shell's backgrounds, and a dismissed file chooser in
  the preferences.
- **A lifecycle flag** ("Lifecycle and Destruction State"): `this._enabling`
  exists only in `scripts/dev-extension.js`, whose `enable()` is async. The
  shipped entry point has none.

The comments explain *why* rather than restating the code, which is what the
guidelines want. Their length is unusual, though, and a reviewer may read that
as a sign.

### metadata.json must be well-formed: meets

See [the table above](#metadatajson).

### Session modes: meets

There is no `session-modes`, so the extension runs in `user` only. On lock it is
disabled: the wallpaper is handed back, which is what the lock screen then shows,
and every renderer goes. On unlock it is enabled again and the base crossfades
in. The alternative, `unlock-dialog`, "MUST be necessary for the extension to
operate correctly", and it is not.

### GSettings schemas: meets

The ID `org.gnome.shell.extensions.wallpaper-engine` and the path
`/org/gnome/shell/extensions/wallpaper-engine/` use the required bases, the file
is named `<schema-id>.gschema.xml`, the XML is in the zip, and no compiled schema
ships.

### Licensing: needs a file

GNOME Shell is GPL-2.0-or-later and "derived works like extensions MUST be
distributed under compatible terms". The repo has no licence file. Add one (for
example GPL-2.0-or-later) as `LICENSE` at the top of the repo, and `make zip`
then includes it. The README says the engine is based on Slider-Overlay. If any
of that code is someone else's, "it MUST include attribution to the original
author in the distributed files".

### Copyrights and trademarks: the name

"Extensions MUST NOT include copyrighted or trademarked content without proof of
express permission from the owner", and brand names come first in its list of
examples. "Wallpaper Engine" is also the name of a well-known commercial Steam
application for animated wallpapers, which is the same field. Expect a reviewer
to raise it, and possibly users to confuse the two. If the name is to change,
change it, and the UUID with it, before the first upload, because the UUID is the
EGO entry. The README (not shipped) also calls the Wave pattern "the iconic PS3
ribbon", which is worth keeping out of the EGO description and screenshots.

### Don't include unnecessary files: meets

`make zip` refuses anything but the shipped modules.

### Use a linter: recommended

There is no ESLint configuration in the repo. GNOME Shell's rules are on
GitLab, as the guideline says, and running them once before the first upload is
cheap.

## Private API

Everything the extension reaches into, what it is for, and what happens when a
future GNOME changes it is in [private-api.md](private-api.md). Reviewers accept
private API with a reason. What they look for is that it fails safely. Every
private path is now checked or optional-chained. The one unsafe case left is a
throw inside `enable()` after the wallpaper is taken over (see
[the open list](#still-open)).

## The development path in extension.js

**Done.** GJS caches a module by URL for the life of the shell, so an edit under
`lib/` is never picked up without logging out, unless `lib/` is imported from a
new URL each time. That staging used to live in the shipped `extension.js`,
behind a test for a symlinked extension directory. A reviewer would have read
code that copies JavaScript out of the extension directory into
`$XDG_RUNTIME_DIR`, deletes a directory tree there, and imports from the copy,
all to defeat the shell's module cache ("Avoid interfering with the Extension
System"). It would also have been dead code in every install EGO produces. It
now lives outside what ships:

- `src/extension.js`, the entry point that ships, imports `./lib/app.js`
  statically. Its `enable()` and `disable()` are synchronous and carry no
  try/catch:
  ```js
  enable() {
      this._app = new WallpaperEngineApp(this);
      this._app.enable();
  }

  disable() {
      this._app.disable();
      this._app = null;
  }
  ```
- `scripts/dev-extension.js` is the development entry point: an async
  `enable()` that copies `lib/` to a fresh
  `$XDG_RUNTIME_DIR/wallpaper-engine/lib-<stamp>/` and imports `app.js` from
  there, with the `_enabling` guard and the logging that belong to it.
- `scripts/dev.sh link` (`link_tree()`) builds the extension directory as a real
  directory of links, one for each entry in `src/` except `extension.js`, which
  links to `scripts/dev-extension.js`. `make reload` still picks up edits.

What is in the repository is what ships, apart from `scripts/`, which never
ships. The development link never runs `src/extension.js`, so test the shipped
entry point from an installed zip
([Testing the zip](#testing-the-zip-before-uploading)).

The alternative was swapping in a plain `extension.js` at pack time. It was
rejected because the zip would then ship a file that is not in the repository
its `url` points at, and two entry points would drift.

## Things a reviewer will notice, and the minimal fix

### Done

1. **The development path in `extension.js`** moved to
   `scripts/dev-extension.js`, as described above.
2. **Logging.** The `console.log` in `app.js` `_build()` is gone, and the one in
   the old `extension.js` went with the development path. The shipped code logs
   only failures.
3. **`_backgroundGroup` is checked.** `_build()` warns and draws nothing when
   it is missing. Deliberately there is no `global.window_group` fallback,
   which would put the patterns over the windows. `disable()` uses `?.` on
   `_interface`, `_overview`, `_system` and `_background`, so it gets through a
   partial enable and always reaches `this._background.destroy()`.
4. **Secondary monitors in the overview.** `_workspacePreviews()` reads
   `view._workspacesView ?? view`, then `_workspaces` or `[_workspace]`. It was
   checked in a two-monitor nested shell on 50.5: the secondary monitor's
   preview shows the patterns.
5. **The holder's container** is kept as `_holderContainer` and destroyed in
   `release()`, and on the path where building the holder fails.
6. **The class cache in `shader.js`** has a comment saying why it survives
   `disable()`.
7. **Defensive checks on guaranteed APIs.** `global.display.get_n_monitors()`,
   `error.matches()` in `system.js` and `e.matches()` in
   `scripts/dev-extension.js` no longer use `?.`.
8. **The try/catch in `extension.js`** is gone from the shipped entry point.
9. **`enable()` undoes itself when it throws** (`app.js`): the shell never
   calls `disable()` for an extension whose `enable()` threw, so `enable()` now
   calls it itself and rethrows, keeping the shell's error state and handing
   the wallpaper back.
10. **`?.` on `index()`** is gone from `workspace.metaWorkspace?.index()`; only
   the private `metaWorkspace`, null for a monitor's extra workspace view, keeps it.

### Still open

1. **The GNOME 51 port.** `Shell.GLSLEffect` is gone in 51; the replacement is
   `Clutter.ShaderEffect` with `vfunc_get_static_snippet()`, which mutter 50
   lacks, so 50 and 51 need two code paths or two releases
   ([compatibility.md](compatibility.md)). Until then, do not claim 51.
2. **`metadata.json`.** Add `version-name`, write a fuller description (the
   points in [metadata.json](#metadatajson)), narrow `shell-version` to what has
   been tested, and settle the name, and the UUID with it, before the first
   upload.
3. **A licence** (outside `src/`). Add a `LICENSE` at the top of the repo;
   `make zip` includes it automatically.
4. **Optional tidying.** Move `lib/scenes.js`, which only the preferences use,
   into a `prefs/` directory, as Best Practices suggests (and add it to the
   `pack` step's sources).

## Uploading

- **Web:** log in at https://extensions.gnome.org/upload/, choose
  `dist/wallpaper-engine@jackt.shell-extension.zip`, and accept the terms.
- **Command line** (gnome-extensions 49 and later; gjs.guide,
  [Port Extensions to GNOME Shell 49](https://gjs.guide/extensions/upgrading/gnome-shell-49.html)):
  `gnome-extensions upload --accept-tos dist/wallpaper-engine@jackt.shell-extension.zip`.
  It prompts for the EGO username and password. `--user`, `--password` and
  `--password-file` exist for CI; gjs.guide warns that a password in a command
  line can end up in logs, the environment or the filesystem.

Each upload is reviewed before it is published, and review comments arrive on
the extension's EGO page. EGO numbers each upload in `version`.

Before every upload:

1. Bump `version-name`.
2. Run `glib-compile-schemas --strict --dry-run src/schemas` and `make check`.
3. Run `make zip`, and read the listing.
4. Install that zip (not the link) and go through the checklist in
   [compatibility.md](compatibility.md) on each version you claim.
5. Confirm `make logs` is quiet through enable, use, lock, unlock and disable.
