// Every pattern's shader, outside the shell -- where a mistake is a message
// rather than a pattern that silently draws nothing.
//
//   node scripts/shaders.mjs check [ids]        compile each with glslangValidator, in
//                                               the GLSL dialects Cogl may hand it to
//   node scripts/shaders.mjs bench [WxH] [ids]  GPU milliseconds per frame for each,
//                                               timed on the real GPU (default 1920x1080)
//
// ids is a comma-separated list of catalog ids; all of them by default.
// check needs glslangValidator; bench needs a C compiler and EGL/GL headers.

import fs from 'fs';
import os from 'os';
import path from 'path';
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
const { shaderSource } = await import(path.join(work, 'shader.mjs'));
const { EFFECTS } = await import(path.join(lib, 'catalog.js'));

const [command = 'check', ...rest] = process.argv.slice(2);
const size = rest.find(a => /^\d+x\d+$/.test(a)) ?? '1920x1080';
const ids = rest.find(a => !/^\d+x\d+$/.test(a))?.split(',');
const effects = EFFECTS.filter(e => !ids || ids.includes(e.id));

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

function check() {
    let failures = 0;
    for (const effect of effects) {
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

function bench() {
    const [w, h] = size.split('x').map(Number);
    const binary = path.join(work, 'shader-bench');
    execFileSync('cc', ['-O2', '-o', binary, path.join(here, 'shader-bench.c'), '-lEGL', '-lOpenGL'], { stdio: 'inherit' });

    let total = 0;
    for (const effect of effects) {
        const uniforms = ['u_epoch 1 0', 'u_seed 1 0'];
        for (const [name, n, values] of effect.State ? new effect.State(w, h, 0).uniforms(100) : [])
            uniforms.push(`${name} ${n} ${Array.from(values).join(' ')}`);
        const file = path.join(work, 'uniforms.txt');
        fs.writeFileSync(file, `${uniforms.join('\n')}\n`);

        const ms = Number(execFileSync(binary, [fragment(effect, DIALECTS['GLSL 3.30']), file, w, h, 400].map(String),
            { stdio: ['ignore', 'pipe', 'ignore'] }));
        total += ms;
        console.log(`${effect.id.padEnd(14)} ${ms.toFixed(3)} ms`);
    }
    console.log(`${'all'.padEnd(14)} ${total.toFixed(3)} ms   (${size}; a 60Hz frame is 16.7 ms, a 240Hz one 4.2)`);
    return 0;
}

let status = 1;
try {
    status = command === 'bench' ? bench() : check();
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}
process.exit(status);
