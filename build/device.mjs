// Bundles src/app/globals.ts -> ui.js (single ESM file for QuickJS device).
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root  = resolve(__dir, '..');

// Schwung shared imports are injected at the top via banner so QuickJS sees
// them before any bundled code. They must not appear in the bundle body.
const SCHWUNG_BANNER = [
    'import * as os from "os";',
    'import { Black, DarkGrey, White, BrightRed, NeonGreen,',
    '         MovePads, MoveKnob1, MidiNoteOn, MidiNoteOff,',
    '         MoveShift, MoveBack, MoveMainButton, MoveMainKnob,',
    '         MoveLeft, MoveRight, MoveUp, MoveDown',
    '} from "/data/UserData/schwung/shared/constants.mjs";',
    'import { setLED, decodeDelta }',
    '    from "/data/UserData/schwung/shared/input_filter.mjs";',
].join('\n');

await esbuild.build({
    entryPoints: [resolve(root, 'src/app/globals.ts')],
    bundle:      true,
    outfile:     resolve(root, 'ui.js'),
    format:      'esm',
    target:      ['es2020'],
    banner:      { js: SCHWUNG_BANNER },
    external:    ['/data/UserData/schwung/*'],
    logLevel:    'info',
});
console.log('Device bundle written: ui.js');
