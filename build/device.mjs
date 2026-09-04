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
    'import * as std from "std";',
    'import { Black, DarkGrey, White, BrightRed, NeonGreen,',
    '         MovePads, MoveKnob1, MidiNoteOn, MidiNoteOff,',
    '         MoveKnob1Touch, MoveKnob8Touch,',
    '         MoveShift, MoveBack, MoveMainButton, MoveMainKnob,',
    '         MoveLeft, MoveRight, MoveUp, MoveDown',
    '} from "/data/UserData/schwung/shared/constants.mjs";',
    'import { setLED, setButtonLED, decodeDelta }',
    '    from "/data/UserData/schwung/shared/input_filter.mjs";',
].join('\n');

/* Debug-only surfaces (the Global Params flags page) compile out of a release
 * build. On unless MOVY_DEBUG=0, so every dev build and every browser test has
 * them; scripts/build-module.sh — the one release path — sets 0 and then
 * ASSERTS the marker is gone, because a define that silently stopped applying
 * would otherwise ship the page. */
const DEBUG = process.env.MOVY_DEBUG !== '0';

const GRID = process.env.MOVY_SCHWUNG_GRID || 'off';

/*
 * THE OFF SWITCH HAS TO BE FREE.
 *
 * `__MOVY_SCHWUNG_GRID__` makes the grid's CODE unreachable in an ordinary
 * build, but unreachable is not absent: esbuild keeps an EXTERNAL import
 * whatever the importing code does, so schwung-body.ts's
 *
 *     import { renderPageMovy, BAND_H } from ".../param_pages/render_page_movy.mjs"
 *
 * survived into a flag-off ui.js. That is 13.5 KB of dead widget code and, far
 * worse, a load-time dependency on a Schwung new enough to serve the file — on
 * an older one an ORDINARY movy fails to start.
 *
 * A define cannot fix it; the modules have to leave the graph. These three are
 * the only importers of param_pages, so swapping them for their `.off`
 * stand-ins takes the whole Schwung layer with them. scripts/schwung-off-is-free.mjs
 * asserts both halves — absent when off, present when on, and it is what caught
 * schwung-editor.ts pulling the library back in when it was added.
 */
const gridOffStubs = {
    name: 'schwung-grid-off',
    setup(build) {
        if (GRID !== 'off') return;
        build.onResolve({ filter: /\/schwung-(body|page|editor)\.js$/ }, (a) => {
            const which = a.path.includes('schwung-body') ? 'body'
                        : a.path.includes('schwung-editor') ? 'editor' : 'page';
            return { path: resolve(root, `src/renderer/schwung-${which}.off.ts`) };
        });
    },
};

await esbuild.build({
    plugins:     [gridOffStubs],
    entryPoints: [resolve(root, 'src/app/globals.ts')],
    bundle:      true,
    outfile:     resolve(root, 'ui.js'),
    format:      'esm',
    target:      ['es2020'],
    banner:      { js: SCHWUNG_BANNER },
    external:    ['/data/UserData/schwung/*'],
    /* MOVY_SCHWUNG_GRID=page builds the experimental grid: Schwung plans the
     * module's pages and draws them, movy targets the parameters. Default 'off'
     * so a normal build is byte-for-byte the movy that shipped. */
    define:      { __MOVY_DEBUG__: String(DEBUG),
                   __MOVY_SCHWUNG_GRID__: JSON.stringify(GRID) },
    logLevel:    'info',
});
console.log(`Device bundle written: ui.js (debug=${DEBUG})`);
