/* browser-test/logic/schwung-page.mjs — what movy still owes the Schwung
 * renderer under `schwunggrid = page`, where Schwung plans AND draws.
 *
 * Under `page` most of the module contract is Schwung's to read: `short_name`
 * (page_plan.mjs), the viz groups (viz.mjs resolveViz) and the enum wire format
 * (param_format.mjs) are all resolved inside param_pages, so movy reading them
 * a second time would be two implementations of one contract. What is left for
 * movy is the half that depends on who owns the HARDWARE — only the surface
 * owner sees a pad — plus the embedding API movy was not using.
 *
 * EVERY ASSERTION IS GUARDED on schwungLibAvailable(). The default build swaps
 * param_pages for a stub that throws on import, which is the whole point: a
 * Schwung that cannot serve the library must cost movy nothing but this
 * feature. Run with SCHWUNG=/path/to/schwung to actually exercise these — a
 * guarded block that never ran is not coverage.
 *
 * Run by browser-test/logic.mjs.
 */

import { schwungLibAvailable, bootModel, eq, ok, _log,
         env, portFor, MOCK_SYNTHS, schwungPageFor, schwungGridReload,
         setSchwungGridMode } from './harness.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: schwung page mode — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nlogic: schwung page mode');

const { surfaceOf } = await import('../../dist/esm/renderer/schwung-voices.js');
const { setSurfaceReader } = await import('../../dist/esm/model/drum-declared.js');

/* `model/` imports nothing from `renderer/`, so the reader is PUSHED IN at
 * start-up — app/globals.ts does exactly this line. Without it `readSurface`
 * answers null and every module falls back to movy's table, which is the
 * correct behaviour with the grid off and the wrong thing to assert against
 * here. Unregistered at the end so the suites after this one see the world
 * they booted in. */
setSurfaceReader(surfaceOf);

/* ── the live-press vouch: reading the declaration ────────────────────────── */

_log('\nTest: a sibling-shape focus_press_param is read off the hierarchy root');
{
    const s = surfaceOf({
        pad_layout: 'drums',
        focus_param: 'ui_voice',
        focus_press_param: 'live_press',
        levels: {
            bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] },
            snare:     { name: 'Snare',     note: 38, knobs: ['vol'] },
        },
    });
    eq('the press param is read', s.pressParam, 'live_press');
    eq('and the focus param still is', s.focusParam, 'ui_voice');
}

_log('\nTest: a template-shape child_press_param is read off the child level');
{
    const s = surfaceOf({
        pad_layout: 'drums',
        levels: {
            pads: {
                child_count: 4, child_key_template: 'p{index}_{key}',
                child_index_param: 'focused_pad',
                child_press_param: 'live_press',
                child_note_base: 36,
                knobs: ['vol'],
            },
        },
    });
    eq('the child level’s press param is read', s.pressParam, 'live_press');
}

_log('\nTest: a module that declares neither has no press param');
{
    /* Absent is the answer for all 78 modules in docs/module-dump/, so this is
     * the case that must cost nothing — no write is ever made. */
    const s = surfaceOf({
        pad_layout: 'drums',
        levels: { bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] } },
    });
    eq('absent stays absent', s.pressParam, null);
}

_log('\nTest: a malformed declaration is an absent one');
{
    eq('non-string root field', surfaceOf({ focus_press_param: 7, levels: {} }).pressParam, null);
    eq('empty string', surfaceOf({ focus_press_param: '', levels: {} }).pressParam, null);
    eq('no hierarchy at all', surfaceOf(null).pressParam, null);
}

/* ── the live-press vouch: reaching the model ─────────────────────────────── */

const RACK_PARAMS = JSON.stringify([
    { key: 'vol', name: 'Vol', type: 'float', min: 0, max: 1 },
]);

_log('\nTest: the declared press param reaches the model');
{
    const m = bootModel({
        'synth:name': 'vouchrack', 'synth_module': 'vouchrack',
        'synth:ui_hierarchy': JSON.stringify({
            pad_layout: 'drums',
            focus_param: 'ui_voice',
            focus_press_param: 'live_press',
            levels: {
                bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] },
                snare:     { name: 'Snare',     note: 38, knobs: ['vol'] },
            },
        }),
        'synth:chain_params': RACK_PARAMS,
        'synth:vol': '0.5',
    });
    for (let i = 0; i < 20; i++) m.tick();
    eq('the model carries the press param', m.getPressParam(), 'live_press');
}

_log('\nTest: a module declaring none leaves the model with null');
{
    const m = bootModel({
        'synth:name': 'plainrack', 'synth_module': 'plainrack',
        'synth:ui_hierarchy': JSON.stringify({
            pad_layout: 'drums',
            levels: { bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] } },
        }),
        'synth:chain_params': RACK_PARAMS,
        'synth:vol': '0.5',
    });
    for (let i = 0; i < 20; i++) m.tick();
    eq('nothing declared, nothing carried', m.getPressParam(), null);
}

setSurfaceReader(null);

/* ── the embedded grid's rect ─────────────────────────────────────────────── */

_log('\nTest: the embedded body rect seats Schwung’s widget rows on movy’s own rows');
{
    const { schwungLib } = await import('../../dist/esm/renderer/schwung-lib.js');
    const { BAND_H } = schwungLib();
    const { GRID_BODY_RECT, ROW0_Y, ROW1_Y, BAR_Y, BAR_H, TOAST_Y } =
        await import('../../dist/esm/renderer/layout.js');

    /* This is the whole reason for supplying a rect at all: upstream reflows
     * ONLY when one is given (render_page_movy.mjs, `const reflow = !!o.rect`),
     * so passing none is not a default — it leaves the body on Schwung's own
     * vertical rhythm, on top of movy's bank bar.
     *
     * The arithmetic is asserted rather than the literal, so this fails if
     * EITHER side moves: movy's row constants or Schwung's band heights. */
    const row0 = GRID_BODY_RECT.y + BAND_H.gutter0;
    const row1 = row0 + BAND_H.widget + BAND_H.label + BAND_H.gutter1;
    const end  = row1 + BAND_H.widget + BAND_H.label;

    eq('widget row 0 is movy’s ROW0_Y', row0, ROW0_Y);
    eq('widget row 1 is movy’s ROW1_Y', row1, ROW1_Y);
    eq('the body clears the bank bar', GRID_BODY_RECT.y >= BAR_Y + BAR_H, true);
    eq('and stops above the toast band', end <= TOAST_Y, true);
    eq('the rect is exactly the room a body needs', GRID_BODY_RECT.h,
       BAND_H.gutter0 + BAND_H.widget + BAND_H.label
       + BAND_H.gutter1 + BAND_H.widget + BAND_H.label);
}

/* ── SP-12: what one tick of a delegated page costs ──────────────────────── */

_log('\nTest: a settled page reads its cursor, not a contract, every tick');
{
    /* SP-12 made the poll PER-TICK — it had to, or the page's read cursor never
     * advances and the cells on screen stop moving. That turned a line that was
     * almost never reached into the page's largest standing cost:
     * `ctl.reloadIfChanged()` is a whole contract read, and it was on every
     * tick. Measured in scripts/grid-call-cost.mjs, the `page` arm's idle floor
     * went 678 -> 1803 host calls per 600 ticks with it there, against movy's
     * own refresh at the 678 it replaces.
     *
     * What the page is ALLOWED is the read cursor: one get_param a tick, which
     * is the budget movy's refresh used to spend on the same values. */
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams(MOCK_SYNTHS.test16);
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    ok('the page resolved', p.ready);

    const TICKS = 64;
    /* Suites before this one delete the param globals rather than restoring
     * them (SP-02's deferred list), so wrapping whatever is there would wrap
     * `undefined`. The env's own restorer is what that cleanup meant. */
    env.restoreParamGlobals();
    const real = globalThis.shadow_get_param;
    let reads = 0;
    globalThis.shadow_get_param = (...a) => { reads++; return real(...a); };
    for (let i = 0; i < TICKS; i++) p.tick();
    globalThis.shadow_get_param = real;

    /* Measured: 80 over 64 ticks — 1 a tick for the cursor plus 2 per contract
     * poll on a divider of 8, the same divider Schwung's own host uses for the
     * same question. The ceiling is 1.5 a tick: comfortably above that, and far
     * below the ~3 a tick a contract read on EVERY tick costs, which is the
     * regression this exists to catch. */
    _log(`    (${reads} reads over ${TICKS} ticks)`);
    eq('a settled page stays within one read a tick plus the paced poll',
       reads <= TICKS + Math.ceil(TICKS / 2), true);

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: both embedded modes, and the off stand-in, use ONE rect');
{
    /* `body` and `page` embed the same grid under the same chrome, and the off
     * stand-in has to stay surface-identical. Three copies of two numbers is
     * how they came to disagree by 2 px in the first place. */
    const { GRID_BODY_RECT } = await import('../../dist/esm/renderer/layout.js');
    const { BODY_Y, BODY_H } = await import('../../dist/esm/renderer/schwung-body.js');
    eq('body mode shares the rect’s y', BODY_Y, GRID_BODY_RECT.y);
    eq('body mode shares the rect’s h', BODY_H, GRID_BODY_RECT.h);
}

}
