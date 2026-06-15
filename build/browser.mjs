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
        resolve(root, 'src/keyboard/state.ts'),
        resolve(root, 'src/app/globals.ts'),
        resolve(root, 'src/seq/engine.ts'),
        resolve(root, 'src/seq/router.ts'),
        resolve(root, 'src/seq/state.ts'),
        resolve(root, 'src/seq/leds.ts'),
        resolve(root, 'src/seq/constants.ts'),
        resolve(root, 'src/seq/colors.ts'),
        resolve(root, 'src/seq/render.ts'),
        resolve(root, 'src/seq/pads.ts'),
        resolve(root, 'src/seq/loop-mode.ts'),
        resolve(root, 'src/seq/step-edit.ts'),
        resolve(root, 'src/seq/edit-ops.ts'),
        resolve(root, 'src/seq/session.ts'),
        resolve(root, 'src/seq/persist.ts'),
        resolve(root, 'src/seq/held.ts'),
        resolve(root, 'src/seq/buttons.ts'),
        resolve(root, 'src/keyboard/leds.ts'),
        resolve(root, 'src/app/state.ts'),
        resolve(root, 'src/seq/momentary.ts'),
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
