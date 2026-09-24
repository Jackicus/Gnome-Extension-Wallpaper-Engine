---
name: drive-extension
description: Run Wallpaper Engine in a throwaway nested GNOME Shell, mirrored live on the user's desktop — screenshot it, compare frames, then shut it down. Use whenever a change must be SEEN (a pattern's look, colours, palettes, opacity, motion, prefs layout), or needs a fresh shell start (extension.js, metadata.json, the schema, a new UUID).
---

# Driving Wallpaper Engine in a nested shell

The extension paints on the desktop background, so the only way to verify a
visual change is to look at it. The nested shell is a complete second GNOME
Shell with its own session bus and virtual monitor, reading the same installed
extension; if the code throws it takes down the *nested* shell, never the
user's.

It runs headless, and `start` opens a **live mirror window on the user's real
desktop** so they can watch. Two people are looking: you through screenshots,
the user through that window. Drive it so both can follow.

## The loop

```bash
S=/tmp/claude-1000/...scratchpad        # your scratchpad; keep shots out of the repo
./scripts/nested.sh start               # ~2 s; Wallpaper Engine is ACTIVE when it returns
./scripts/nested.sh do "say Baseline" "shot $S/before.png"
# ... edit src/ ...
./scripts/nested.sh reload
./scripts/nested.sh do "say After the wave change" "shot $S/after.png"
./scripts/nested.sh stop                # closes the mirror window too
```

Then **Read the PNGs** and say what actually differs. If nothing visibly
changed, say so; do not assume the edit worked.

## Batch with `do` — one call per interaction

`do` runs every step over a single connection, so a whole check is **one** tool
call, and it stops at the first failing step:

```bash
./scripts/nested.sh do \
  "say Nebula only" "wait 1" "shot $S/nebula.png" \
  "say Nebula plus embers" "wait 1" "shot $S/both.png"
```

| Step | Does |
|---|---|
| `say TEXT` | Banner in the nested shell (≤ ~40 chars, no apostrophes — steps are shell-split). Put one before every step the user should follow. |
| `click X Y` / `move X Y` | Click / hover at desktop coordinates |
| `key KEYSYM` | `Escape`, `Return`, arrows, `F1`–`F12`, one character, or a chord like `Super+Page_Down` (`F11` fullscreens most apps; `Alt+F10` maximizes where a tiling extension has taken `Super+Up`) |
| `wait SECS` | Let something land. An animated pattern never settles, so a wait here is about giving a settings change a frame or two, not about a transition ending. |
| `shot [FILE [X Y W H]]` | Screenshot, or **just a region** — crop to the part you are judging rather than reading 1600×900 every time |
| `overview on\|off` | Show/hide the overview. Nothing dismisses it until `off`. |

The same steps exist as single commands (`./scripts/nested.sh shot …`) for a
one-off; prefer `do`. Other commands: `status`, `reload`, `logs [N] [--all]`,
`mirror on|off`, `run CMD…` (against the nested bus), `start --headless [WxH]`.

## Changing what is drawn

Everything visible is a GSettings key, so the way to exercise a pattern is to
set one inside the nested session and take a shot:

```bash
./scripts/nested.sh run gsettings set org.gnome.shell.extensions.wallpaper-engine \
    enabled-effects "['aurora']"
./scripts/nested.sh run gsettings set org.gnome.shell.extensions.wallpaper-engine \
    background-mode color
```

`app.js` watches those keys and repaints without a reload. Useful ones:
`enabled-effects` (`as` of catalog ids), `background-mode`
(`desktop`/`color`/`image`), `color-palette`, `speed`, `opacity`, `target-fps`.

**Two frames of the same animation are not a comparison.** The patterns move, so
a before/after pair always differs a little. Judge shape, colour, density and
brightness, and set `speed` to something very low if a frame needs to be
comparable at all.

**Driving the prefs dialog:**
`./scripts/nested.sh run gnome-extensions prefs wallpaper-engine@jackt &` opens
it inside the nested session, where `shot` and the mirror both show it — this is
how prefs layout gets checked without touching the real desktop.

## Closing what you open

**`stop` when the task is finished — including when a check failed.** It closes
the mirror window, the shell, its bus and the screencast. Keep one shell up
while iterating and `reload` into it; `start` reuses a running one.

Backstops, so a forgotten `stop` never strands a window on the user's desktop:
- the mirror window closes by itself when the nested shell stops or crashes;
- a shell started from a Claude Code session stops itself after 10 minutes with
  no `nested.sh` command (`WALLPAPER_NESTED_IDLE=<seconds>` at `start`, `0` = never);
- the project's SessionEnd hook stops it when that session ends.

Do not rely on them — they are for accidents. If the idle stop hit mid-task,
`start` again (~2 s).

**`stop` + `start` at least once before calling a change done.** `reload` keeps
the old dconf snapshot and whatever the previous build left on screen; only a
fresh start exercises `extension.js`, the enable path and first-frame layout the
way a login does. Edits to `extension.js`, `metadata.json` or the schema *need*
one (and a schema edit needs `glib-compile-schemas src/schemas` first —
`reload` does not recompile).

## When it looks wrong

`logs` first. A JS exception during enable leaves a bare wallpaper, which reads
as "no change", and `engine.js` catches a throwing layer per frame — so a broken
pattern looks like one that was never enabled. `logs` hides D-Bus activation and
portal chatter; `logs 200 --all` shows everything. `[WallpaperEngine]` lines are
the extension's own.

## Gotchas

- **dconf is shared with the real session, and the nested one can clobber it.**
  The nested `dconf-service` caches the database at start and rewrites the whole
  file on its first write, so a setting changed from the real session while a
  nested shell runs is silently lost once anything in the nested one writes a
  key. Change settings **before** `start`, **after** `stop`, or through
  `nested.sh run gsettings` — not from the real session mid-run.
- **The real session can clobber the nested one's writes, too.** A `reload` that
  fails with "Enabled but not ACTIVE" and nothing in `logs`, or a key set with
  `run gsettings` that reads back as its old value, is the real session's dconf
  service rewriting the file from a stale copy. `stop` + `start` recovers; for
  settings, set them **before** `start` (through the real session's
  `gsettings --schemadir src/schemas`), not mid-run.
- **Headless without the mirror never paints.** With nothing consuming frames the
  compositor does not draw, so a CPU or GPU reading taken under
  `start --headless` measures nothing. Measure with the mirror on — it adds a
  constant screencast cost, so compare readings with each other, not with zero.
- **`start` enables the extension** if dconf doesn't list it — which writes
  `enabled-extensions`, so the real session will load it at the next login too.
- **Never click or hover at the top-left.** It is the Activities hot corner and
  throws the shell into the overview. Pointer motion is absolute; coordinates
  outside the monitor are rejected.
- **A screen-sharing indicator in the top bar** is the input/screencast session,
  not an extension bug.
- **`Eval` is blocked** (unsafe mode off): no arbitrary-JS escape hatch. Drive it
  through gsettings, input and D-Bus like a user would.
- **Screenshots and banners borrow a bus name**
  (`org.gnome.SettingsDaemon.MediaKeys`, unclaimed on the throwaway bus) because
  the shell refuses unknown callers. Never try that against the real session.
- **Other extensions load too** (the nested shell reads the same extension
  list), so their log lines and top-bar icons appear alongside this one.
- **The mirror needs GStreamer's PipeWire plugin.** If `mirror on` fails, use
  `start --headless` and screenshots, and tell the user.
