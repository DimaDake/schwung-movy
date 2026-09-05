#!/usr/bin/env node
/*
 * schwung-plock-view-check.mjs — a parameter lock must show on BOTH views.
 *
 * Schwung marks a locked cell from the `decorations` movy passes into
 * `render(title, auto, touched)`, and that `auto` is `lastAutoView` — a
 * module-level in tick.ts.
 *
 * It was assigned in exactly ONE place: the VIEW_KNOBS branch. The VIEW_CHAIN
 * branch builds its own automation view inline, hands it to getViewModel, and
 * throws it away. So on VIEW_CHAIN — THE VIEW MOVY OPENS ON — Schwung was
 * rendered with whatever view a previous VIEW_KNOBS frame happened to leave
 * behind, or with `undefined` if the user never went there. Reported from the
 * device as "i can't see p locks working in the UI".
 *
 * The shape is the one this project keeps hitting: a value that is correct on
 * the path it was written for and stale on the one nobody drove. schwung-app-check
 * renders both views but asserts on the PAGE SET, not on the lock marks, so it
 * passed throughout.
 *
 * Asserted as a pixel difference between a page with a locked lane and the same
 * page without one, on each view independently. A lock mark is small — a 2x2
 * corner tick per locked cell — so the threshold is low, but it is compared
 * against the SAME page unlocked rather than against a constant.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-plock-view-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';
import { installMockEngine } from '../browser-test/mock-engine.mjs';
import { MOCK_SYNTHS } from '../browser-test/mock-synth.mjs';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
const paint = (x, y, w, h, v) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) fb[yy * W + xx] = v ? 1 : 0;
};
const env = installEnv();
const engine = installMockEngine();
globalThis.fill_rect = (x, y, w, h, v) => paint(x, y, w, h, v);
globalThis.clear_screen = () => paint(0, 0, W, H, 0);
globalThis.setLED = () => {};
globalThis.setButtonLED = () => {};

const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };

await import('../dist/esm/app/globals.js');
const { appState, VIEW_KNOBS, VIEW_CHAIN } = await import('../dist/esm/app/state.js');
const { resetSeqState, seqState } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { setFlag } = await import('../dist/esm/seq/flags.js');
const { setSchwungGridMode, schwungGridReload } =
    await import('../dist/esm/renderer/schwung-grid.js');

let failed = 0;
const ok   = (m) => _log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => { _log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };
const snap = () => fb.slice();
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
const advance = (n = 1) => { for (let i = 0; i < n; i++) globalThis.tick(); };

function boot(view) {
    engine.reset();
    env.setParams(MOCK_SYNTHS.plaits);
    resetSeqState(); resetSeqEngine();
    schwungGridReload();
    setFlag('chtracks', 0);
    setFlag('setcommit', 0);
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(14);
    appState.currentView = view;
    advance(8);
}

/*
 * Lock the parameter under knob 1. Two halves, and BOTH are needed — the first
 * draft did only the first and failed on every view, which looked like a much
 * bigger bug than the real one:
 *
 *   1. bind the lane, so `laneForKey` can find the parameter, and
 *   2. report `aauto`, the engine's bitmask of lanes that actually HOLD locks.
 *      `activeLanes` comes only from there (seq/engine.ts parses `aauto`), so a
 *      bound-but-empty lane decorates nothing — correctly.
 *
 * The target is asked of the SCHWUNG page, not of movy's model: under the grid
 * the two planners put different keys in the same cell, so binding movy's
 * answer would lock a parameter that is not on screen and the check would fail
 * for the wrong reason.
 */
async function lockKnob1() {
    const { schwungPageFor } = await import('../dist/esm/renderer/schwung-grid.js');
    const { assignLane } = await import('../dist/esm/seq/automation.js');
    const sp = schwungPageFor(0, 'synth');
    const info = sp.knobParamInfo(1);
    if (!info) return null;
    /* THE REGISTRY IS MOVY'S OWN, not something a port write reaches. An
     * earlier draft wrote `knob_1_set` to the port and reported `aauto`, which
     * left the registry empty — laneForKey then matched nothing, decorations
     * came back null, and the check failed on both views for a reason that had
     * nothing to do with the bug. assignLane is the real binding. */
    const lane = assignLane(0, 1, info, () => true);
    if (lane < 0) return null;
    engine.status.aauto = (1 << lane).toString(16);
    advance(4);
    return info.target + ':' + info.ioKey;
}

_log('schwung-plock-view-check: a lock shows on the view movy opens on too\n');

for (const [label, view] of [['VIEW_KNOBS', VIEW_KNOBS], ['VIEW_CHAIN', VIEW_CHAIN]]) {
    setSchwungGridMode('page');
    boot(view);
    /* Force the repaint. The frame is drawn only when something is dirty, so
     * clearing and ticking would otherwise leave BOTH snapshots blank — and
     * two blank frames are identical, which reads as "the lock changed
     * nothing" no matter how well the lock works. That is exactly how the
     * first draft of this check lied. */
    appState.dirty = true; advance(2);
    const clean = snap();

    const target = await lockKnob1();
    if (!target) { fail(`${label}: no parameter under knob 1 to lock`); continue; }
    appState.dirty = true; advance(2);
    const locked = snap();

    const moved = diff(clean, locked);
    if (moved > 0) {
        ok(`${label}: the lock on ${target} marks the page (${moved} px)`);
    } else {
        fail(`${label}: locking ${target} changed NOTHING on screen. Schwung is being rendered `
           + `with a stale or absent automation view — tick.ts assigns lastAutoView in the `
           + `VIEW_KNOBS branch only, and schwungBodyFor renders from it on both.`);
    }
}

setSchwungGridMode('off');
if (failed) { _log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
_log('\n\x1b[32m\x1b[1mPASS: a parameter lock marks the grid on both views.\x1b[0m');
