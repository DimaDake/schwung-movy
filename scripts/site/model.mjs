/* The facts the diagrams draw — pad maps, scales, track colours, the drum rack —
 * come from movy's own source, bundled on the fly, so a figure can never show a
 * layout or a colour the device does not. */
import { build } from 'esbuild';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const entry = `
export { buildPadMap, MODE_CHROMATIC, MODE_IN_KEY, LAYOUT_FOURTHS, LAYOUT_PIANO, LAYOUT_INLINE, COLS, ROWS } from './src/keyboard/layouts.ts';
export { SCALES, inScaleFor } from './src/seq/scales.ts';
export { TRACK_COLOR, TRACK_COLOR_DIM, C_GREEN, C_WHITE, C_DARKGREY, C_LIGHTGREY, C_REC_RED } from './src/seq/colors.ts';
export { drumPadOfPhys } from './src/keyboard/drum-grid.ts';
`;

const out = await build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true, format: 'esm', write: false, platform: 'node', logLevel: 'error',
});
const movy = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
export default movy;
