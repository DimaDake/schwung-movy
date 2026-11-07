/* browser-test/logic/preset-door.mjs — knob 1 on a Schwung preset door, and
 * where the door's body ends on movy's screen.
 *
 * `obxd`'s root level is a real dumped module with a PAGE_PRESET door
 * (`list_param`/`count_param`) AND a declared bank (`banks`: items_param
 * `fxb_bank_list`, select_param `bank_index`, navigate_to root, 3 banks in the
 * dump), so every count here is the fixture's, not one this file invents.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log, env, MOCK_SYNTHS, schwungPageFor, schwungGridReload } from './harness.mjs';

export async function run() {

_log('\nlogic: preset door');

const { dumpFixture } = await import('../dump-fixture.mjs');
const { schwungLib } = await import('../../dist/esm/renderer/schwung-lib.js');
const lib = schwungLib();

/* A fresh obxd page, parked on its preset door with the count read. */
async function onPresetDoor() {
    schwungGridReload();
    env.setParams(dumpFixture('obxd'));
    schwungGridReload();
    const pg = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !pg.ready; i++) pg.tick();
    ok('obxd resolved', pg.ready);
    const at = pg.ctl.pages.findIndex((p) => p.kind === lib.PAGE_PRESET);
    ok('the fixture has a preset door', at >= 0);
    pg.ctl.goToPage(at);
    /* `tickPreset` reads count/index/name one per tick (`read % 3`): without
     * the count, `stepPreset` bails and the turn looks inert for an unrelated
     * reason. */
    for (let i = 0; i < 5; i++) pg.tick();
    return { pg, at };
}
const presetOf = (pg) => pg.ctl.state.preset[pg.ctl.page.name] || { index: 0 };

_log('\nTest: SP-44 — knob 1 walks a preset door without entering it');
{
    const { pg, at } = await onPresetDoor();
    eq('not entered yet', pg.ctl.menuEntered(), false);
    const before = presetOf(pg).index;
    /* One CC's worth of raw detents — DETENTS_PER_ENTRY (6) — so one call
     * moves one entry without leaning on the acceleration curve. */
    pg.knobTurn(0, 6);
    ok('the preset index moved', presetOf(pg).index !== before);
    /* Reported: "the knob turn focuses the preset page, so the next jog turn
     * walks presets instead of paging". The knob is a gesture, not a click in. */
    eq('...and the door is still shut', pg.ctl.menuEntered(), false);
    const lv = pg.knobLevels();
    ok('knob 1 lights its LED on the door', typeof lv[0] === 'number');
    eq('...and no other knob does', lv.slice(1).every((v) => v === null), true);
    pg.changePage(1);
    ok('the next jog pages away', pg.ctl.pageIndex !== at);
}

_log('\nTest: Shift + knob 1 steps the declared bank, landing on its first preset');
{
    const { pg } = await onPresetDoor();
    pg.knobTurn(0, 6);
    pg.knobTurn(0, 6);
    ok('a plain turn walked off preset 1', presetOf(pg).index > 0);
    eq('bank starts at 0', portRead('bank_index'), '0');

    pg.knobTurn(0, 6, true);
    eq('Shift+turn selects the next bank', portRead('bank_index'), '1');
    eq('...and loads that bank\'s first preset', portRead('preset'), '0');
    eq('...which the door shows', presetOf(pg).index, 0);
    eq('...without entering it', pg.ctl.menuEntered(), false);

    /* Schwung's setBank wraps at both ends. */
    pg.knobTurn(0, -6, true);
    pg.knobTurn(0, -6, true);
    eq('Shift+turn back past the first bank wraps to the last', portRead('bank_index'), '2');

    /* Less than a detent is banked, not lost, and does not step. */
    pg.knobTurn(0, 3, true);
    eq('half a detent does not step the bank', portRead('bank_index'), '2');
    pg.knobTurn(0, 3, true);
    eq('the other half does', portRead('bank_index'), '0');
}

_log('\nTest: Shift + knob 1 with no declared bank is a plain preset step');
{
    const { pg } = await onPresetDoor();
    /* The same door with its bank list gone: Schwung's sound_generator_ui only
     * takes Shift for banks when bankCount > 1, and otherwise steps the preset. */
    env.params['synth:fxb_bank_list'] = '[]';
    const before = presetOf(pg).index;
    pg.knobTurn(0, 6, true);
    ok('the preset moved instead', presetOf(pg).index !== before);
}

_log('\nTest: a preset door\'s body stays above movy\'s bottom bar');
{
    const { pg } = await onPresetDoor();
    const rects = [];
    const orig = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => { if (v) rects.push({ x, y, w, h }); };
    try { pg.render('OBXD'); } finally { globalThis.fill_rect = orig; }
    ok('the door drew something', rects.length > 0);
    /* RULE_Y (55) is where Schwung's own footer rule sits; movy's bar and toast
     * row start at TOAST_Y (58). Before the fix the brackets ran to row 63. */
    const lowest = Math.max(...rects.map((r) => r.y + r.h));
    ok(`nothing lit below row 55 (lowest ${lowest})`, lowest <= 55);
    /* ...so the Loop strip may draw there: the door does not claim the band
     * and movy puts no pills over it. */
    eq('the door leaves the bottom band to the Loop strip', pg.claimsBottomBand(), false);
    /* Pills only ever show under a held knob — which on a door is knob 1,
     * mid-browse, exactly when the strip should stay up. */
    pg.knobTouch(0, true);
    eq('...and knob 1 held puts no footer pills over it', pg.chrome(true).footer, null);
    pg.knobTouch(0, false);
    pg.ctl.openPicker();
    eq('the section picker over it still claims the band', pg.claimsBottomBand(), true);
    pg.ctl.closePicker();
}

/* A module that renames itself when its index is written, the way amino and
 * most preset browsers do. Restored by the caller. */
function renameOnLoad() {
    const prev = globalThis.shadow_set_param;
    globalThis.shadow_set_param = (s, k, v) => {
        const r = prev(s, k, v);
        if (k === 'synth:preset') env.params['synth:preset_name'] = 'NAME' + v;
        return r;
    };
    return () => { globalThis.shadow_set_param = prev; };
}

_log('\nTest: a preset step shows the NEW preset\'s name, not the one just left');
{
    const { pg } = await onPresetDoor();
    const restore = renameOnLoad();
    try {
        /* Several steps, so at least one lands mid-epoch, where the name was
         * already in the read cache — the case that showed the old name. */
        let stale = 0;
        for (let step = 0; step < 4; step++) {
            pg.knobTurn(0, 6);
            const want = 'NAME' + presetOf(pg).index;
            for (let t = 0; t < 12; t++) {
                pg.tick();
                if (presetOf(pg).name !== want || pg.ctl.presetName !== want) stale++;
            }
        }
        eq('no tick shows the previous preset\'s name', stale, 0);
    } finally { restore(); }
}

_log('\nTest: a preset name that lands LATE still asks for a frame');
{
    /* A module that loads off-thread publishes the name after the step's read.
     * No value, mark or knob level moves with it, so before the fix nothing
     * repainted and the stale name stayed up: "it never recovers". */
    const { pollDrawnPage } = await import('../../dist/esm/app/page-poll.js');
    const { pg } = await onPresetDoor();
    const owner = { poll: () => pg.tick(), page: pg, ref: { track: 0, componentKey: 'synth' } };
    for (let i = 0; i < 40; i++) pollDrawnPage(owner);
    let quiet = true;
    for (let i = 0; i < 20; i++) if (pollDrawnPage(owner)) quiet = false;
    ok('the door settles quiet', quiet);
    env.params['synth:preset_name'] = 'LATE ARRIVAL';
    let moved = false;
    for (let i = 0; i < 24 && !moved; i++) moved = pollDrawnPage(owner);
    ok('the late name asks for a frame', moved);
    eq('...and the door holds it', presetOf(pg).name, 'LATE ARRIVAL');
}

function portRead(key) {
    return env.params[`synth:${key}`] ?? null;
}

schwungGridReload();
env.setParams(MOCK_SYNTHS.test16);
}
