#!/usr/bin/env node
/*
 * schwung-editor-check.mjs — a divable param opens a list you can choose from.
 *
 * Schwung's controller answers a click on a held divable param with
 * `{action:"open", key, options, index}` and then stops: "The controller never
 * opens it itself — that screen belongs to the host." movy had no such screen,
 * so Plaits' 24-option `engine` could only be crossed one detent at a time.
 *
 * The screen is movy's, but the LIST is Schwung's `drawEnumList` — the same
 * widget every other picker on the device uses, which is what keeps a second
 * list from drifting. (It only became usable from an embedding host once
 * drawEnumList forwarded its ctx to drawMenuList; before that its body drew
 * through the device globals.)
 *
 * THE COMMIT GOES THROUGH `commitEnum`, not through the port. Some modules
 * store an enum as its INDEX and others as its NAME, and the controller already
 * knows which — writing the index straight to the port would silently set the
 * wrong value on every name-valued enum. It also carries the write throttle,
 * the announce, and the condition re-plan.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-editor-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';
import { MOCK_SYNTHS } from '../browser-test/mock-synth.mjs';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
const env = installEnv();
globalThis.fill_rect = (x, y, w, h, v) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) fb[yy * W + xx] = v ? 1 : 0;
};
globalThis.clear_screen = () => { fb = new Uint8Array(W * H); };

const REAL_NOW = Date.now;
let clock = REAL_NOW();
Date.now = () => clock;

const { portFor } = await import('../dist/esm/track/registry.js');
const { createSchwungPage } = await import('../dist/esm/renderer/schwung-page.js');
const ED = await import('../dist/esm/renderer/schwung-editor.js');

const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };

let failed = 0;
const ok   = (m) => _log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => { _log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };
const snap = () => fb.slice();
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

function open() {
    env.setParams(MOCK_SYNTHS.plaits);
    const p = createSchwungPage(portFor(0), 'synth');
    for (let i = 0; i < 80 && !p.ready; i++) { clock += 16; p.tick(); }
    ED.closeSchwungEditor();
    p.knobTouch(0, true);
    const intent = p.click();
    ED.openSchwungEditor(intent, p);
    return { p, intent };
}

_log('schwung-editor-check: a divable param opens a list\n');

/* ---- it opens, and it draws Schwung's list ------------------------------ */
{
    const { intent } = open();
    if (ED.schwungEditorActive()) ok(`the editor opens for ${intent.key} (${intent.options.length} options)`);
    else fail('an "open" intent did not open the editor');

    globalThis.clear_screen();
    ED.renderSchwungEditor();
    const lit = fb.reduce((a, b) => a + b, 0);
    /* A 24-row list fills the screen; a blank or header-only draw does not.
     * Compared against a floor rather than an exact count so the list can be
     * restyled upstream without this failing for the wrong reason. */
    if (lit > 300) ok(`it draws the list (${lit} lit pixels)`);
    else fail(`it drew only ${lit} lit pixels — the list body is missing. drawEnumList must be `
            + `given the same ctx its header and footer use.`);
}

/* ---- the jog moves the cursor and the screen follows -------------------- */
{
    open();
    globalThis.clear_screen(); ED.renderSchwungEditor();
    const before = snap();
    const i0 = ED.schwungEditorIndex();
    ED.schwungEditorJog(1);
    globalThis.clear_screen(); ED.renderSchwungEditor();
    const moved = diff(before, snap());

    if (ED.schwungEditorIndex() === i0 + 1) ok(`the jog moves the cursor (${i0} -> ${ED.schwungEditorIndex()})`);
    else fail(`the jog left the cursor at ${ED.schwungEditorIndex()}, wanted ${i0 + 1}`);
    if (moved > 20) ok(`...and the list redraws (${moved} px)`);
    else fail(`...but the screen changed only ${moved} px — the cursor moved and nothing showed it`);
}

/* ---- a click commits, and Back does not --------------------------------- */
{
    const { p, intent } = open();
    const key = 'synth:' + intent.key;
    const before = p.ctl.state.values[intent.key];
    ED.schwungEditorJog(1); ED.schwungEditorJog(1);
    const want = ED.schwungEditorIndex();
    ED.schwungEditorCommit();
    for (let i = 0; i < 40; i++) { clock += 16; p.tick(); }

    if (!ED.schwungEditorActive()) ok('a click closes the editor');
    else fail('the editor stayed open after a commit');

    const after = p.ctl.state.values[intent.key];
    if (String(after) !== String(before)) {
        ok(`...and the value moved (${before} -> ${after}, option ${want})`);
    } else {
        fail(`...but the value is still ${before}. The commit must go through `
           + `ctl.commitEnum(key, index) — it owns the index-vs-name wire format.`);
    }
}
{
    const { p, intent } = open();
    const before = p.ctl.state.values[intent.key];
    ED.schwungEditorJog(1); ED.schwungEditorJog(1);
    ED.schwungEditorCancel();
    for (let i = 0; i < 40; i++) { clock += 16; p.tick(); }

    if (!ED.schwungEditorActive()) ok('Back closes the editor');
    else fail('Back left the editor open');
    const after = p.ctl.state.values[intent.key];
    if (String(after) === String(before)) ok(`...and writes nothing (still ${before})`);
    else fail(`...but the value changed to ${after}. Back cancels; only a click commits.`);
}

Date.now = REAL_NOW;
if (failed) { _log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
_log('\n\x1b[32m\x1b[1mPASS: a divable param opens Schwung\'s list, the jog moves it, a click commits, Back cancels.\x1b[0m');
