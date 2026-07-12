#!/usr/bin/env node
/* Upscale test screenshot baselines 4× (nearest-neighbor → crisp 1-bit) into
 * docs/assets/ for use in README.md / MANUAL.md. The docs reference the scaled
 * copies (128×64 is too small to read inline); this keeps them in sync with the
 * committed test baselines.
 *
 * Usage: node scripts/make-doc-assets.mjs <baseline-name> [<baseline-name> ...]
 *   e.g. node scripts/make-doc-assets.mjs lfo_lfo1 lfo_assign_toast
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const dir  = dirname(fileURLToPath(import.meta.url));
const root = join(dir, '..');
const SCALE = 4;

// pngjs is a dev dep of the screenshot harness (browser-test/node_modules).
const { PNG } = createRequire(join(root, 'browser-test/screenshot.mjs'))('pngjs');

const names = process.argv.slice(2);
if (names.length === 0) {
    console.error('usage: make-doc-assets.mjs <baseline-name>...');
    process.exit(1);
}

for (const name of names) {
    const src = PNG.sync.read(readFileSync(join(root, 'browser-test/screenshots/baseline', name + '.png')));
    const out = new PNG({ width: src.width * SCALE, height: src.height * SCALE });
    for (let y = 0; y < out.height; y++) {
        for (let x = 0; x < out.width; x++) {
            const sx = Math.floor(x / SCALE), sy = Math.floor(y / SCALE);
            const si = (sy * src.width + sx) * 4, di = (y * out.width + x) * 4;
            out.data[di]     = src.data[si];
            out.data[di + 1] = src.data[si + 1];
            out.data[di + 2] = src.data[si + 2];
            out.data[di + 3] = src.data[si + 3];
        }
    }
    writeFileSync(join(root, 'docs/assets', name + '.png'), PNG.sync.write(out));
    console.log(`wrote docs/assets/${name}.png (${out.width}×${out.height})`);
}
