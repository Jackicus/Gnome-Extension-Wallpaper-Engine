// The patterns are drawn by the GPU, one fragment shader each.
//
// Each pattern in lib/layers/ is a GLSL function from a pixel to a
// premultiplied colour, named after its id; this wraps one in a
// `Shell.GLSLEffect`, which paints an actor with it. Nothing is drawn on the
// CPU and nothing is uploaded per frame but a handful of uniforms, so the
// compositor thread no longer pays per pixel, and the patterns are drawn at the
// monitor's full resolution.
//
// One shader per pattern rather than one for the lot: a shader is compiled for
// the worst case of everything in it, and all eight in one ran at two thirds
// the speed of the same eight apart.

import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';

// Shell.SnippetHook moved to Cogl in GNOME 48.
const FRAGMENT = Shell.SnippetHook?.FRAGMENT ?? Cogl.SnippetHook.FRAGMENT;

// How much scene time u_time carries before it rolls over into u_epoch.
export const EPOCH_S = 1024;

// Shared by every pattern. Coordinates are monitor pixels, y down; `U` is one
// pixel of a 1080-line screen, so a pattern sized in U looks the same on any
// monitor, only sharper on a denser one.
//
// Time arrives in two parts because a 32-bit float cannot hold an hour of it
// to the fraction of a millisecond a frame needs: past that, motion steps
// unevenly from one frame to the next. u_time is the seconds since the last
// whole epoch and stays small; the helpers below fold the epoch in with the
// large part reduced first, so its rounding is a constant that shifts once an
// epoch, not a jitter every frame.
const COMMON = `
uniform vec2 u_res;
uniform float u_time;
uniform float u_epoch;
uniform float u_seed;

#define U (u_res.y / 1080.0)
#define TAU 6.28318530718

// The argument for sin(w * t).
float wphase(float w) {
    return mod(w * u_epoch, TAU) + w * u_time;
}

// v * t, for something that repeats every "period".
vec2 scroll(vec2 v, float period) {
    return mod(v * u_epoch, period) + v * u_time;
}

// A life that repeats every "period" seconds, offset by "phase" of one:
// x counts the lives so far, y is how far through this one it is.
vec2 lifecycle(float period, float phase) {
    float e = u_epoch / period;
    float c = fract(e) + u_time / period + phase;
    return vec2(floor(e) + floor(c), fract(c));
}

// Hashes without sine (Dave Hoskins): stable across GPUs, no bit operations.
float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

vec4 hash42(vec2 p) {
    vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}

// Smooth value noise in [0, 1], and a three-octave sum of it. Both repeat
// every 256 units, which is what lets drift() below keep moving through them
// without a seam.
float vnoise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(mod(i, 256.0));
    float b = hash12(mod(i + vec2(1.0, 0.0), 256.0));
    float c = hash12(mod(i + vec2(0.0, 1.0), 256.0));
    float d = hash12(mod(i + vec2(1.0, 1.0), 256.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}

float fbm(vec2 x) {
    return (vnoise(x) * 0.5 + vnoise(x * 2.0 + vec2(17.3, 9.1)) * 0.25 +
            vnoise(x * 4.0 + vec2(-31.7, 23.9)) * 0.125) / 0.875;
}

// a * t, as a distance through the noise above.
float drift(float a) {
    return mod(a * u_epoch, 256.0) + a * u_time;
}

// A point of light: a coloured halo around a white-hot core, premultiplied.
// d is the distance from its centre and r its radius, in pixels; core is how
// much of the radius is white. Neither part is allowed narrower than a pixel
// -- it is widened and dimmed to match instead -- so a small light moving
// across the pixel grid glides rather than flickering.
vec4 glow(float d, float r, vec3 rgb, float core) {
    float d2 = d * d;
    float hs = r * 0.33;
    float hw = max(hs, 0.6);
    float halo = 0.9 * (hs * hs) / (hw * hw) * exp(-0.5 * d2 / (hw * hw));
    float cs = r * core * 0.6;
    float cw = max(cs, 0.5);
    float hot = min(1.0, (cs * cs) / (cw * cw)) * exp(-0.5 * d2 / (cw * cw));
    float a = halo + hot * (1.0 - halo);
    return vec4(mix(rgb * halo, vec3(a), hot), a);
}

// Coverage of a line "width" wide at distance d from its centre, antialiased
// over one pixel.
float line(float d, float width) {
    return clamp(0.5 * width + 0.5 - d, 0.0, 1.0) * min(1.0, width);
}

float segmentDistance(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - a - ab * h);
}
`;

// GType names last as long as the process, and this module is loaded afresh on
// every enable, so each load names its classes apart.
const LOAD = GLib.uuid_string_random().slice(0, 8);
const classes = new Map();

/**
 * The effect class for one pattern (a catalog entry with `glsl`).
 *
 * GLSLEffect compiles its pipeline once per class, so this is built the first
 * time a pattern is shown, and every monitor's instance of it shares it.
 */
export function effectClass(effect) {
    if (!classes.has(effect.id)) classes.set(effect.id, buildEffectClass(effect));
    return classes.get(effect.id);
}

/**
 * A pattern's shader as Cogl takes it: declarations, and the body of main().
 * Also what scripts/shaders.mjs compiles and times outside the shell.
 */
export function shaderSource(effect) {
    return {
        declarations: `${COMMON}\n${effect.glsl}`,
        code: `
            vec2 p = cogl_tex_coord_in[0].st * u_res;
            cogl_color_out = clamp(${effect.id}(p), 0.0, 1.0) * cogl_color_in.a;
        `,
    };
}

function buildEffectClass(effect) {
    const { declarations, code } = shaderSource(effect);

    return GObject.registerClass({
        GTypeName: `WallpaperEngine_${effect.id}_${LOAD}`,
    }, class extends Shell.GLSLEffect {
        vfunc_build_pipeline() {
            this.add_glsl_snippet(FRAGMENT, declarations, code, true);
        }

        // The last moment before this frame is drawn: whoever set onPaint
        // fills the uniforms in here, so the time the pattern shows is the
        // time the frame is painted rather than when it was asked for.
        vfunc_paint_target(node, paintContext) {
            this.onPaint?.();
            super.vfunc_paint_target(node, paintContext);
        }

        setUniform(name, components, values) {
            let location = this._locations?.get(name);
            if (location === undefined) {
                this._locations ??= new Map();
                location = this.get_uniform_location(name);
                this._locations.set(name, location);
            }
            if (location >= 0) this.set_uniform_float(location, components, values);
        }
    });
}
