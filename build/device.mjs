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

/* The Schwung renderer is now a SETTING, so an ordinary build carries both
 * renderers and `schwunggrid` chooses. This switch is the other axis: whether
 * the layer is in the bundle at all. Default in; MOVY_NO_SCHWUNG_GRID=1 takes
 * it out, which is what keeps `scripts/schwung-off-is-free.mjs` meaningful and
 * leaves a way to ship a build with no Schwung dependency whatsoever. */
const NO_GRID = process.env.MOVY_NO_SCHWUNG_GRID === '1';

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
 * A define cannot fix it; the modules have to leave the graph. These five are
 * the only importers of param_pages, so swapping them for their `.off`
 * stand-ins takes the whole Schwung layer with them. scripts/schwung-off-is-free.mjs
 * asserts both halves — absent when off, present when on, and it is what caught
 * schwung-editor.ts pulling the library back in when it was added.
 */
const gridOffStubs = {
    name: 'schwung-grid-off',
    setup(build) {
        if (!NO_GRID) return;
        build.onResolve({ filter: /\/schwung-(body|page|editor|widgets|voices|lib)\.js$/ }, (a) => {
            /* `lib` is the one that matters: it is the only module that names
             * param_pages now, so leaving it out of this list left the whole
             * layer in a build that had asked for none of it. The other four
             * still swap so their code goes too. */
            const which = a.path.includes('schwung-body') ? 'body'
                        : a.path.includes('schwung-editor') ? 'editor'
                        : a.path.includes('schwung-widgets') ? 'widgets'
                        : a.path.includes('schwung-voices') ? 'voices'
                        : a.path.includes('schwung-lib') ? 'lib' : 'page';
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
    define:      { __MOVY_DEBUG__: String(DEBUG) },
    /* schwung-lib.ts awaits its imports at module top level, which is the one
     * place movy can await at all: `eval_buf` runs `js_std_await` on the
     * module's result, so the host load blocks until they settle and every
     * global assigned afterwards is in place before the load reports success.
     * es2020 has no top-level await, and without this esbuild rewrites the
     * module into a form that defers evaluation. */
    supported:   { 'top-level-await': true },
    logLevel:    'info',
});
console.log(`Device bundle written: ui.js (debug=${DEBUG}, schwung-grid=${NO_GRID ? 'absent' : 'available'})`);
