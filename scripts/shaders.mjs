// Every pattern's shader, outside the shell -- where a mistake is a message
// rather than a pattern that silently draws nothing.
//
//   node scripts/shaders.mjs check [PATTERNS]         compile each with glslangValidator, in
//                                                     the GLSL dialects Cogl may hand it to
//   node scripts/shaders.mjs bench [WxH] [PATTERNS]   GPU milliseconds per frame for each
//   node scripts/shaders.mjs render PATTERN [OPTIONS] draw frames of one to a PNG
//
// PATTERNS is a comma-separated list of catalog ids, or paths to layer modules
// (a pattern not yet in the catalog); all of the catalog by default. Sizes
// default to 1920x1080. check needs glslangValidator; bench and render need a
// C compiler and EGL/GL headers, and run on the real GPU.
//
// render options:
//   --out FILE       where to write the PNG (default: PATTERN.png here)
//   --size WxH       one monitor's size (default 1920x1080)
//   --span N         N such monitors side by side, drawn as one spanned canvas
//   --t SECONDS      the pattern's time for the first frame (default 30)
//   --frames N       frames, stacked top to bottom (default 1)
//   --step SECONDS   time between them (default 0.5)
//   --density D      the amount setting (default 1)
//   --bg NAME        a palette name, or "black" (default Classic Blue)

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { execFileSync } from 'child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const lib = path.join(here, '..', 'src', 'lib');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wallpaper-engine-shaders-'));

// shader.js wraps the GLSL in GObject classes the shell provides. Only its pure
// half is wanted here, so the gi imports become a stand-in that absorbs any use.
const stub = new Proxy(function () {}, { get: () => stub, apply: () => stub });
globalThis.__giStub = stub;
const shaderJs = fs.readFileSync(path.join(lib, 'shader.js'), 'utf8')
    .replace(/^import (\w+) from 'gi:\/\/\w+';$/mg, 'const $1 = globalThis.__giStub;');
fs.writeFileSync(path.join(work, 'shader.mjs'), shaderJs);
const { shaderSource, EPOCH_S } = await import(path.join(work, 'shader.mjs'));

// A pattern by catalog id, or straight from its module file.
async function patterns(list) {
    const files = list?.split(',').filter(p => p.endsWith('.js')) ?? [];
    const ids = list?.split(',').filter(p => !p.endsWith('.js'));
    const found = [];
    if (!list || ids.length) {
        const { EFFECTS } = await import(path.join(lib, 'catalog.js'));
        found.push(...EFFECTS.filter(e => !list || ids.includes(e.id)));
    }
    for (const file of files) {
        const module = await import(path.resolve(file));
        found.push({ id: path.basename(file, '.js'), ...module });
    }
    return found;
}

const args = process.argv.slice(2);
const command = args.shift() ?? 'check';
const option = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args.splice(at, 2)[1] : fallback;
};

// What Cogl puts around a snippet, near enough to compile it the same way.
const DIALECTS = {
    'GLSL 1.10': ['#version 110', 'varying vec4 cogl_color_in;\nvarying vec4 cogl_tex_coord_in[1];', '#define cogl_color_out gl_FragColor'],
    'GLSL 3.30': ['#version 330', 'in vec4 cogl_color_in;\nin vec4 cogl_tex_coord_in[1];', 'out vec4 cogl_color_out;'],
    'GLSL ES 1.00': ['#version 100\nprecision highp float;', 'varying vec4 cogl_color_in;\nvarying vec4 cogl_tex_coord_in[1];', '#define cogl_color_out gl_FragColor'],
};

function fragment(effect, [version, inputs, output]) {
    const { declarations, code } = shaderSource(effect);
    const file = path.join(work, `${effect.id}.frag`);
    fs.writeFileSync(file, `${version}\n${inputs}\n${output}\n${declarations}\nvoid main() {\n${code}\n}\n`);
    return file;
}

// Everything the engine sets, for one monitor at `origin` in a canvas.
function uniforms(effect, { width, height, canvasWidth = width, originX = 0, t = 30, density = 1 }) {
    const unit = height / 1080;
    const epoch = Math.floor(t / EPOCH_S) * EPOCH_S;
    const [low, high] = effect.density ?? [1, 1];
    const d = Math.max(low, Math.min(high, density));
    const lines = [
        `u_res 2 ${width} ${height}`, `u_origin 2 ${originX} 0`, `u_gain 1 1`,
        `u_canvas 2 ${canvasWidth} ${height}`, `u_unit 1 ${unit}`, `u_seed 1 0`, `u_density 1 ${d}`,
        `u_epoch 1 ${epoch}`, `u_time 1 ${t - epoch}`,
    ];
    if (effect.State) {
        const state = new effect.State({
            width: canvasWidth, height, unit, seed: 0,
            rect: { x: originX, y: 0, width, height },
        });
        for (const [name, n, values] of state.uniforms(t, d))
            lines.push(`${name} ${n} ${Array.from(values).join(' ')}`);
    }
    const file = path.join(work, 'uniforms.txt');
    fs.writeFileSync(file, `${lines.join('\n')}\n`);
    return file;
}

let binary = null;
function harness() {
    if (!binary) {
        binary = path.join(work, 'shader-bench');
        execFileSync('cc', ['-O2', '-o', binary, path.join(here, 'shader-bench.c'), '-lEGL', '-lOpenGL'], { stdio: 'inherit' });
    }
    return binary;
}

async function check() {
    let failures = 0;
    for (const effect of await patterns(args[0])) {
        const errors = [];
        for (const [name, dialect] of Object.entries(DIALECTS)) {
            try {
                execFileSync('glslangValidator', [fragment(effect, dialect)], { stdio: 'pipe' });
            } catch (e) {
                errors.push(`${name}:\n${e.stdout || e.message}`);
            }
        }
        console.log(`${effect.id.padEnd(14)} ${errors.length ? `FAILED\n${errors.join('\n')}` : 'ok'}`);
        failures += errors.length;
    }
    return failures ? 1 : 0;
}

async function bench() {
    const size = args.find(a => /^\d+x\d+$/.test(a)) ?? '1920x1080';
    const [width, height] = size.split('x').map(Number);
    let total = 0;
    for (const effect of await patterns(args.find(a => !/^\d+x\d+$/.test(a)))) {
        const shader = fragment(effect, DIALECTS['GLSL 3.30']);
        const ms = Number(execFileSync(harness(), [shader, uniforms(effect, { width, height, t: 100 }), width, height, 400].map(String),
            { stdio: ['ignore', 'pipe', 'ignore'] }));
        total += ms;
        console.log(`${effect.id.padEnd(14)} ${ms.toFixed(3)} ms`);
    }
    console.log(`${'all'.padEnd(14)} ${total.toFixed(3)} ms   (${size}; a 60Hz frame is 16.7 ms, a 240Hz one 4.2)`);
    return 0;
}

async function render() {
    const [width, height] = option('size', '1920x1080').split('x').map(Number);
    const span = Number(option('span', 1));
    const t0 = Number(option('t', 30));
    const frames = Number(option('frames', 1));
    const step = Number(option('step', 0.5));
    const density = Number(option('density', 1));
    const bg = option('bg', 'Classic Blue');
    const [effect] = await patterns(args[0]);
    if (!effect) throw new Error('render needs a pattern: a catalog id or a layer file');
    const out = option('out', `${effect.id}.png`);

    const shader = fragment(effect, DIALECTS['GLSL 3.30']);
    const canvasWidth = width * span;
    const background = backdrop(bg, canvasWidth, height);
    const image = Buffer.alloc(canvasWidth * (height + 4) * frames * 3);
    const rowBytes = canvasWidth * 3;

    for (let f = 0; f < frames; f++) {
        const t = t0 + f * step;
        const rgba = path.join(work, 'frame.rgba');
        execFileSync(harness(), [shader, uniforms(effect, { width: canvasWidth, height, canvasWidth, t, density }),
            canvasWidth, height, 1, rgba].map(String), { stdio: ['ignore', 'ignore', 'inherit'] });
        const pixels = fs.readFileSync(rgba);
        // Premultiplied over the backdrop, as the compositor lays it over the
        // wallpaper; GL's rows run bottom up.
        for (let y = 0; y < height; y++) {
            const src = (height - 1 - y) * canvasWidth * 4;
            const dst = (f * (height + 4) + y) * rowBytes;
            for (let x = 0; x < canvasWidth; x++) {
                const a = pixels[src + x * 4 + 3] / 255;
                for (let c = 0; c < 3; c++) {
                    const under = background[(y * canvasWidth + x) * 3 + c];
                    image[dst + x * 3 + c] = Math.min(255, pixels[src + x * 4 + c] + under * (1 - a));
                }
            }
        }
        // Seams between monitors, and between frames, marked faintly.
        for (let m = 1; m < span; m++)
            for (let y = 0; y < height; y += 6) image.fill(90, (f * (height + 4) + y) * rowBytes + m * width * 3, (f * (height + 4) + y) * rowBytes + m * width * 3 + 3);
        image.fill(128, (f * (height + 4) + height) * rowBytes, (f * (height + 4) + height + 4) * rowBytes);
    }

    fs.writeFileSync(out, png(canvasWidth, (height + 4) * frames, image));
    console.log(`${out}: ${effect.id} at t=${t0}${frames > 1 ? ` +${step}s x${frames}` : ''}, ${canvasWidth}x${height}` +
        `${span > 1 ? ` (${span} monitors spanned)` : ''}, density ${density}`);
    return 0;
}

// The base the patterns are drawn over: a palette's gradient, as background.js
// renders it, or black.
function backdrop(name, w, h) {
    const rgb = Buffer.alloc(w * h * 3);
    if (name === 'black') return rgb;
    const stops = readStops(name);
    const [x0, y0, x1, y1] = [w * 0.1, 0, w * 0.9, h];
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const g = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
            let i = 1;
            while (i < stops.length - 1 && stops[i][0] < g) i++;
            const [o0, ...c0] = stops[i - 1];
            const [o1, ...c1] = stops[i];
            const k = Math.max(0, Math.min(1, (g - o0) / (o1 - o0 || 1)));
            for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = c0[c] + (c1[c] - c0[c]) * k;
        }
    }
    return rgb;
}

// palettes.js imports cairo, which node lacks, so the stops are read from its
// source instead.
function readStops(name) {
    const source = fs.readFileSync(path.join(lib, 'palettes.js'), 'utf8');
    const line = source.split('\n').find(l => l.includes(`'${name}':`)) ??
        source.split('\n').find(l => l.includes("'Classic Blue':"));
    return JSON.parse(line.slice(line.indexOf('['), line.lastIndexOf(']') + 1));
}

// A minimal PNG: 8-bit RGB, unfiltered rows.
function png(w, h, rgb) {
    const chunk = (type, data) => {
        const head = Buffer.alloc(8);
        head.writeUInt32BE(data.length, 0);
        head.write(type, 4, 'ascii');
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
        return Buffer.concat([head, data, crc]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(h, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const rows = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) rgb.copy(rows, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
    ]);
}

let status = 1;
try {
    status = await { check, bench, render }[command]?.() ?? (console.error(`unknown command ${command}`), 1);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}
process.exit(status);
