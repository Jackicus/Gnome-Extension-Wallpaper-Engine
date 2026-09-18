#!/usr/bin/env bash
#
# Wallpaper Engine development helper.
#
#   ./scripts/dev.sh link       symlink src/ into the extensions dir (dev mode)
#   ./scripts/dev.sh install    copy src/ into the extensions dir (real install)
#   ./scripts/dev.sh reload     recompile schemas and disable/enable the extension
#   ./scripts/dev.sh prefs      open the extension settings menu
#   ./scripts/dev.sh logs [since]  shell logs; follows unless given e.g. '5 min ago'
#   ./scripts/dev.sh uninstall  remove the extension
#   ./scripts/dev.sh status     show what is currently installed and enabled
#
set -euo pipefail

UUID="wallpaper-engine@jackt"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_DIR/src"
EXT_ROOT="$HOME/.local/share/gnome-shell/extensions"
EXT_DIR="$EXT_ROOT/$UUID"

info()  { printf '\033[1;34m→\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

require() {
    command -v "$1" >/dev/null 2>&1 || die "'$1' not found in PATH."
}

compile_schemas() {
    require glib-compile-schemas
    info "Compiling GSettings schemas..."
    glib-compile-schemas "$SRC_DIR/schemas"
}

remove_installed() {
    if [[ -e "$EXT_DIR" || -L "$EXT_DIR" ]]; then
        rm -rf "$EXT_DIR"
    fi
}

is_enabled() {
    gnome-extensions list --enabled 2>/dev/null | grep -qx "$UUID"
}

cmd_link() {
    compile_schemas
    remove_installed
    mkdir -p "$EXT_ROOT"
    ln -s "$SRC_DIR" "$EXT_DIR"
    ok "Linked $EXT_DIR → $SRC_DIR"
    warn "Dev mode: edits in src/ are live. Run './scripts/dev.sh reload' to apply them."
    enable_extension
}

cmd_install() {
    compile_schemas
    remove_installed
    mkdir -p "$EXT_DIR"
    cp -r "$SRC_DIR"/. "$EXT_DIR"/
    ok "Installed to $EXT_DIR"
    enable_extension
}

enable_extension() {
    require gnome-extensions
    if is_enabled; then
        cmd_reload
    else
        info "Enabling $UUID..."
        if gnome-extensions enable "$UUID" 2>/dev/null; then
            ok "Enabled."
        else
            warn "The running GNOME Shell does not know about $UUID yet."
            warn "Log out and back in (Wayland) or Alt+F2 'r' (X11), then: make reload"
        fi
    fi
}

wait_for_state() {
    local want="$1" tries=0
    while (( tries < 60 )); do
        [[ "$(gnome-extensions info "$UUID" 2>/dev/null | sed -n 's/^ *State: *//p')" == "$want" ]] && return 0
        sleep 0.1
        tries=$((tries + 1))
    done
    return 1
}

cmd_reload() {
    require gnome-extensions
    compile_schemas
    info "Reloading $UUID..."
    gnome-extensions disable "$UUID" 2>/dev/null || true
    wait_for_state INACTIVE || warn "Extension did not report INACTIVE; enabling anyway."
    gnome-extensions enable "$UUID"
    if wait_for_state ACTIVE; then
        ok "Reloaded. extension.js cache-busts the module import, so no shell restart needed."
    else
        warn "Extension is enabled but not ACTIVE. Check './scripts/dev.sh logs' for a JS error."
        return 1
    fi
}

cmd_prefs() {
    require gnome-extensions
    info "Opening preferences for $UUID..."
    gnome-extensions prefs "$UUID" &
}

cmd_logs() {
    require journalctl
    if [[ -n "${1:-}" ]]; then
        info "Wallpaper Engine log output since '$1':"
        journalctl -o cat /usr/bin/gnome-shell --since "$1" 2>/dev/null \
            | grep -i "WallpaperEngine" || info "(nothing logged in that window)"
    else
        info "Following GNOME Shell logs (Ctrl+C to stop)..."
        journalctl -f -o cat /usr/bin/gnome-shell | grep --line-buffered -i "WallpaperEngine"
    fi
}

cmd_uninstall() {
    require gnome-extensions
    info "Uninstalling $UUID..."
    gnome-extensions disable "$UUID" 2>/dev/null || true
    remove_installed
    ok "Uninstalled."
}

cmd_status() {
    require gnome-extensions
    echo "=== Extension Status ==="
    gnome-extensions info "$UUID" 2>/dev/null || echo "$UUID is not installed."
}

cmd_help() {
    cat <<EOF
Usage: ./scripts/dev.sh <command>

Commands:
  link         Symlink src/ into extensions dir and enable (development mode)
  install      Copy src/ into extensions dir and enable
  reload       Recompile schemas and reload extension (no shell restart needed)
  prefs        Open the extension preferences / settings menu
  logs [since] Show or follow GNOME Shell logs for WallpaperEngine
  uninstall    Disable and remove the extension
  status       Show current installation and activation status
  help         Show this help
EOF
}

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
    link)      cmd_link ;;
    install)   cmd_install ;;
    reload)    cmd_reload ;;
    prefs)     cmd_prefs ;;
    logs)      cmd_logs "${1:-}" ;;
    uninstall) cmd_uninstall ;;
    status)    cmd_status ;;
    help|-h|--help) cmd_help ;;
    *) die "Unknown command '$COMMAND'. Run './scripts/dev.sh help' for usage." ;;
esac
