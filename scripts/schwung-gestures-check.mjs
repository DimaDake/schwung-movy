#!/usr/bin/env node
/*
 * schwung-gestures-check.mjs — click and Back are LADDERS, not single actions.
 *
 * movy's binding had `click: () => { ctl.onClick(); }` and no Back at all. That
 * one line drops four separate behaviours, because Schwung's click is a ladder
 * (page_input.mjs):
 *
 *     picker open?      -> pickerSelect()
 *     on a door page?   -> onClick(-1)
 *     no knob held?     -> openPicker()          <- the section picker
 *     otherwise         -> onClick(held)         <- may return an "open" intent
 *
 * and its Back is another, one layer at a time:
 *
 *     dismissHint() -> dismissPeek() -> closePicker() -> exitMenu() -> exit
 *
 * Passing no slot meant onClick never saw which knob was under the hand, so a
 * divable param could not be opened; discarding the return meant the "open"
 * intent went nowhere; and never calling openPicker meant the section picker
 * was unreachable on a 24-page module.
 *
 * THE LADDERS ARE NOT REIMPLEMENTED HERE OR IN THE BINDING. movy calls
 * Schwung's own `applyInput`, so the two cannot drift — the same reason the
 * binding drives the controller instead of restating its rules. Knobs are the
 * deliberate exception: applyInput's knob intent carries a DIRECTION, one
 * detent per call, which is exactly the magnitude bug schwung-knob-feel-check
 * exists to catch. movy keeps its own knob path.
 *
 * Plaits' `engine` is the case that motivates it: a divable enum with 24
 * options. Without the open intent the only way through 24 engines is 24
 * detents, with no list.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-gestures-check.mjs
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

const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };

let failed = 0;
const ok   = (m) => _log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => { _log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };
const ink  = () => fb.reduce((a, b) => a + b, 0);
const snap = () => fb.slice();
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

function pageFor(preset) {
    env.setParams(MOCK_SYNTHS[preset]);
    const p = createSchwungPage(portFor(0), 'synth');
    for (let i = 0; i < 80 && !p.ready; i++) { clock += 16; p.tick(); }
    return p;
}

_log('schwung-gestures-check: click and Back are ladders\n');

/* ---- the section picker: a click with no knob held ---------------------- */
{
    const p = pageFor('plaits');
    if (p.ctl.state.touched >= 0) p.knobTouch(p.ctl.state.touched, false);
    const r = p.click();
    if (p.ctl.pickerOpen) ok('a click with no knob held opens the section picker');
    else fail('a click with no knob held did not open the section picker — openPicker() is never called');
    if (r === null || r === undefined) ok('...and reports no intent for the host to act on');
    else fail(`...but returned ${JSON.stringify(r)}; opening the picker is not a host intent`);

    /* It must also be drawable and dismissable, or it is a trap. Compared
     * against the SAME page with the picker shut — `ink() > 0` would be true of
     * any page at all and could never fail. */
    clock += 16; p.tick(); globalThis.clear_screen(); p.render('T1');
    const withPicker = snap();
    p.ctl.closePicker();
    clock += 16; p.tick(); globalThis.clear_screen(); p.render('T1');
    const without = diff(withPicker, snap());
    if (without > 500) ok(`the picker draws over the grid (${without} px vs the page beneath)`);
    else fail(`the picker changed only ${without} px against the plain page — it is open in `
            + `state but not on screen`);
    p.ctl.openPicker();

    const b = p.back();
    if (!p.ctl.pickerOpen) ok('Back closes the picker');
    else fail('Back left the picker open');
    if (!b) ok('...and does NOT exit the module — one layer at a time');
    else fail(`...but returned ${JSON.stringify(b)}; Back must take the picker down first`);
}

/* ---- Back with nothing open is the module's own Back -------------------- */
{
    const p = pageFor('plaits');
    const b = p.back();
    if (b && b.action === 'exit') ok('Back with no layer open reports "exit" for movy to act on');
    else fail(`Back with nothing open returned ${JSON.stringify(b)}, wanted {action:"exit"}`);
}

/* ---- a divable enum: click on the held knob returns an "open" intent ---- */
{
    const p = pageFor('plaits');
    const meta = p.ctl.metaAt(0);
    if (!meta || !meta.divable) {
        fail('plaits slot 0 is not divable in this build — the fixture moved, and this check '
           + 'cannot see the open intent without one');
    } else {
        p.knobTouch(0, true);
        const r = p.click();
        if (r && r.action === 'open') {
            ok(`clicking a held divable enum returns an "open" intent (${r.key}, `
             + `${r.options ? r.options.length : 0} options)`);
        } else {
            fail(`clicking a held divable param returned ${JSON.stringify(r)}, wanted `
               + `{action:"open"}. onClick needs the HELD SLOT and its return value.`);
        }
        if (r && r.options && r.options.length > 2) {
            ok(`...carrying the option list, so a host can show all ${r.options.length}`);
        } else {
            fail('...but with no option list — the host has nothing to draw');
        }
    }
}

/* ---- the enum peek: turning a divable enum shows Schwung's list --------- */
{
    const p = pageFor('plaits');
    clock += 16; p.tick(); globalThis.clear_screen(); p.render('T1');
    const before = snap();

    p.knobTouch(0, true);
    p.knobTurn(0, 1);
    clock += 16; p.tick(); globalThis.clear_screen(); p.render('T1');
    const after = snap();

    const moved = diff(before, after);
    /* A peek is a full-screen panel, so it moves a large fraction of the frame.
     * The knob's own arc moving is a few dozen pixels; requiring a big change
     * is what separates "the overlay drew" from "the value changed". */
    if (moved > 500) {
        ok(`turning a divable enum draws the peek list (${moved} px changed)`);
    } else {
        fail(`turning a divable enum changed only ${moved} px — the controller's own peek `
           + `overlay is not being drawn. render() must call ctl.renderOverlays(ctx, `
           + `{clearScreen}); without a clearScreen it declines to draw.`);
    }

    const b = p.back();
    if (!b) ok('Back takes the peek down rather than leaving the module');
    else fail(`Back during a peek returned ${JSON.stringify(b)} — it should dismiss the peek first`);
}

Date.now = REAL_NOW;
if (failed) { _log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
_log('\n\x1b[32m\x1b[1mPASS: the click and Back ladders are Schwung\'s, and the open intent reaches movy.\x1b[0m');
