// Bundles model + renderer entry points -> dist/esm/ for browser tests.
// Code splitting puts shared code in chunk files; JSON configs are inlined.
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');

await esbuild.build({
    entryPoints: [
        resolve(root, 'src/model/index.ts'),
        resolve(root, 'src/renderer/knob-view.ts'),
        resolve(root, 'src/renderer/keys-view.ts'),
        resolve(root, 'src/renderer/browse-view.ts'),
        resolve(root, 'src/renderer/chain-view.ts'),
        resolve(root, 'src/keyboard/drum-handler.ts'),
        resolve(root, 'src/seq/engine.ts'),
        resolve(root, 'src/seq/router.ts'),
        resolve(root, 'src/seq/state.ts'),
    ],
    bundle:    true,
    splitting: true,
    outdir:    resolve(root, 'dist/esm'),
    outbase:   resolve(root, 'src'),
    format:    'esm',
    target:    ['es2020'],
    logLevel:  'info',
});
console.log('Browser modules written: dist/esm/');
