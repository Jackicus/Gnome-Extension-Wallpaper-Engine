// The patterns in the shell's own pictures of a workspace: the Activities
// overview, its thumbnail strip, and the slide between workspaces.
//
// None of those shows the desktop background group. Every workspace preview
// builds a wallpaper actor of its own and clones that workspace's windows over
// it, so a canvas parented into `_backgroundGroup` is simply not in the picture
// -- open the overview and the desktop underneath goes still and bare. This
// puts it back the way the shell puts the windows back: as a clone, laid into
// the preview's own background group where the overview's scaling carries it
// exactly as it carries the wallpaper.
//
// Nothing here is built twice or drawn twice: a clone is a second view of the
// canvas that is already being painted. The clones belong to the previews, which
// the shell destroys when the overview closes.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';

// A preview's background group stands for a whole monitor, but it is allocated
// at whatever size the overview has animated the workspace to -- and stretched
// independently in x and y while that animation runs. Reading the allocation
// back as a scale is the only way to follow that reliably: the group
// re-allocates without always notifying its size.
const PreviewHost = GObject.registerClass(
class PreviewHost extends Clutter.Actor {
    _init(props, monitor) {
        super._init(props);
        this._monitor = monitor;
    }

    // The preview sizes itself from its porthole, not from what is in it: a
    // size request here would stretch the workspace out of shape.
    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        const clone = this.get_first_child();
        if (!clone) return;

        const scaleX = box.get_width() / this._monitor.width;
        const scaleY = box.get_height() / this._monitor.height;
        if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX <= 0 || scaleY <= 0)
            return;

        // The overview re-allocates its previews on most frames of its own
        // animation; a scale that has not moved is not worth setting again.
        if (scaleX === this._scaleX && scaleY === this._scaleY) return;
        this._scaleX = scaleX;
        this._scaleY = scaleY;
        clone.set_scale(scaleX, scaleY);
    }
});

export class OverviewCanvas {
    /**
     * `sourceFor(monitorIndex)` hands over the live canvas for that monitor, or
     * null where there is none.
     */
    constructor(sourceFor) {
        this._sourceFor = sourceFor;
        this._clones = [];
        this._attached = false;
        this._injections = new InjectionManager();
    }

    enable() {
        // 'showing' is early enough: the previews exist before the overview
        // animates in, so the clones are there for the first frame rather than
        // appearing once it has settled.
        Main.overview.connectObject(
            'showing', () => this._attach(),
            'hidden', () => this._detach(),
            this);

        if (Main.overview.visible) this._attach();

        const animation = Main.wm._workspaceAnimation;
        if (animation?._prepareWorkspaceSwitch) {
            const self = this;
            this._injections.overrideMethod(
                Object.getPrototypeOf(animation), '_prepareWorkspaceSwitch',
                original => function (...args) {
                    // It returns early, touching nothing, when a slide is
                    // already under way (a swipe picked up mid-flight).
                    const fresh = !this._switchData;
                    original.apply(this, args);
                    if (fresh && this._switchData) self._joinSlide(this._switchData);
                });
        }
    }

    destroy() {
        this._injections.clear();
        Main.overview.disconnectObject(this);
        this._detach();
    }

    // The layout changed under an open overview.
    invalidate() {
        if (!this._attached) return;
        this._detach();
        this._attach();
    }

    /**
     * For as long as a workspace slide runs the shell covers the desktop with a
     * strip of workspaces, each over a wallpaper of its own, and throws the strip
     * away when it lands. A clone in each means the patterns travel with the
     * workspace instead of reappearing once it has arrived.
     */
    _joinSlide(switchData) {
        for (const strip of switchData.monitors ?? []) {
            const index = strip._monitor?.index;
            const source = index === undefined ? null : this._sourceFor(index);
            if (!source) continue;

            for (const group of strip._workspaceGroups ?? []) {
                // Over the wallpaper and under the workspace's own windows.
                const wallpaper = group._background?.get_first_child();
                if (wallpaper)
                    group._background.insert_child_above(this._cloneOf(source), wallpaper);
            }
        }
    }

    _attach() {
        this._attached = true;

        const monitors = Main.layoutManager.monitors;

        for (const workspace of this._workspacePreviews()) {
            const background = workspace._background;
            const group = background?._backgroundGroup;
            const index = background?._monitorIndex;
            if (!group || index === undefined) continue;

            const source = this._sourceFor(index);
            const monitor = monitors[index];
            if (!source || !monitor) continue;

            const host = new PreviewHost({
                name: `WallpaperEnginePreview:${index}`,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                x_expand: true,
                y_expand: true,
                reactive: false,
            }, monitor);
            host.add_child(this._cloneOf(source));
            group.add_child(host);
            this._track(host);

            // The strip at the top of the overview shows the same workspaces at
            // thumbnail size; its contents are laid out in stage coordinates, as
            // the window clones beside this one are.
            const wsIndex = workspace.metaWorkspace?.index?.();
            const thumbnails = Main.overview._overview?.controls?._thumbnailsBox?._thumbnails ?? [];
            const contents = thumbnails[wsIndex]?._contents;
            if (contents) {
                const clone = this._cloneOf(source);
                clone.set_position(monitor.x, monitor.y);
                contents.add_child(clone);
                this._track(clone);
            }
        }
    }

    // A clone is never reactive, so the click that activates the workspace
    // passes through it.
    _cloneOf(source) {
        return new Clutter.Clone({
            source,
            reactive: false,
            width: source.width,
            height: source.height,
        });
    }

    // The previews are the overview's, and it destroys them when it closes --
    // taking the clones with them -- so nothing here outlives one overview.
    _detach() {
        this._attached = false;
        for (const actor of [...this._clones]) actor.destroy();
        this._clones = [];
    }

    _track(actor) {
        this._clones.push(actor);
        actor.connect('destroy', () => {
            const at = this._clones.indexOf(actor);
            if (at >= 0) this._clones.splice(at, 1);
        });
    }

    // The workspace previews, across every monitor's view.
    _workspacePreviews() {
        const views = Main.overview._overview?.controls?._workspacesDisplay?._workspacesViews ?? [];
        const out = [];
        for (const view of views) out.push(...(view._workspaces ?? []));
        return out;
    }
}
