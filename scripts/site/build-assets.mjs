#!/usr/bin/env node
/* Regenerates the website's images.
 *
 *   site/assets/diagrams/<name>.svg  every figure in figures.mjs
 *   site/assets/screens/<name>.png   each screenshot a page (or README.md)
 *                                    references, upscaled 4x from the test
 *                                    baseline of the same name
 *
 * Screens come from browser-test/screenshots/baseline, so the site always
 * shows what the UI really draws: after `screenshot.mjs --update`, rerun this.
 * A page referencing a screen with no baseline fails the run. Screens no page
 * references are deleted, so the folder never carries stale pictures.
 *
 * Usage: node scripts/site/build-assets.mjs [--check]
 *   --check  write nothing; exit 1 if any image is missing or out of date. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { figures } from './figures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const { PNG } = createRequire(join(root, 'browser-test/screenshot.mjs'))('pngjs');
const check = process.argv.includes('--check');
const SCALE = 4;
let stale = 0;

function emit(path, data) {
    const same = existsSync(path) && Buffer.compare(readFileSync(path), Buffer.from(data)) === 0;
    if (same) return;
    stale++;
    if (check) { console.error('out of date: ' + path); return; }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    console.log('wrote ' + path.slice(root.length + 1));
}

function upscale(name) {
    const src = PNG.sync.read(readFileSync(join(root, 'browser-test/screenshots/baseline', name + '.png')));
    const out = new PNG({ width: src.width * SCALE, height: src.height * SCALE });
    for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
        const si = (Math.floor(y / SCALE) * src.width + Math.floor(x / SCALE)) * 4, di = (y * out.width + x) * 4;
        for (let k = 0; k < 4; k++) out.data[di + k] = src.data[si + k];
    }
    return PNG.sync.write(out);
}

function markdownFiles(dir) {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? markdownFiles(p) : n.endsWith('.md') ? [p] : [];
    });
}

for (const [name, svg] of Object.entries(figures(root))) emit(join(root, 'site/assets/diagrams', name + '.svg'), svg);

const wanted = new Set();
for (const md of [...markdownFiles(join(root, 'site')), join(root, 'README.md')]) {
    for (const m of readFileSync(md, 'utf8').matchAll(/assets\/screens\/([\w-]+)\.png/g)) wanted.add(m[1]);
}
let missing = 0;
for (const name of wanted) {
    if (!existsSync(join(root, 'browser-test/screenshots/baseline', name + '.png'))) {
        console.error(`no baseline for screens/${name}.png`); missing++; continue;
    }
    emit(join(root, 'site/assets/screens', name + '.png'), upscale(name));
}
const screens = join(root, 'site/assets/screens');
if (existsSync(screens)) for (const f of readdirSync(screens)) {
    if (!wanted.has(f.replace(/\.png$/, ''))) {
        stale++;
        if (check) console.error('unreferenced: site/assets/screens/' + f);
        else { unlinkSync(join(screens, f)); console.log('removed site/assets/screens/' + f); }
    }
}
if (missing || (check && stale)) process.exit(1);
