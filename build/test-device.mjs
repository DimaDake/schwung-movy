// Compiles test-device/*.ts -> test-device/dist/. Separate from the browser
// build: those entry points are movy's own src/ compiled for pixel tests, while
// this is the device harness, which imports nothing from src/ by design.
import * as esbuild from 'esbuild';
import { rmSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');
const src   = resolve(root, 'test-device');
const out   = resolve(src, 'dist');

/* Same reason as the browser build: esbuild only writes what this build
 * produces, so a dropped entry point would leave a stale file that a test goes
 * on importing. */
rmSync(out, { recursive: true, force: true });

const walk = (dir, acc = []) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'dist' || e.name === 'device-agent' || e.name === 'selftest') continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (e.name.endsWith('.ts')) acc.push(p);
    }
    return acc;
};

await esbuild.build({
    entryPoints: walk(src),
    outdir:   out,
    outbase:  src,
    platform: 'node',
    format:   'esm',
    target:   ['node20'],
    bundle:   false,
    logLevel: 'info',
});
console.log('Device harness written: test-device/dist/');
