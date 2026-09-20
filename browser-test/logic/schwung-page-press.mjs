/* schwung-page-press.mjs — what a pad press costs before its page is on screen.
 *
 * SP-39. Its own module because `schwung-page.mjs` is at the browser-test line
 * ceiling and because the subject is a MEASUREMENT rather than a contract: the
 * tests next door assert what the delegated page plans and draws, this one
 * asserts what the gesture that turns it spends on the wire.
 *
 * Run by browser-test/logic.mjs, after `schwung-page.mjs` — it re-arms the grid
 * and drops it again on the way out.
 */

import { schwungLibAvailable, eq, ok, _log,
         env, portFor, MOCK_SYNTHS, schwungPageFor, schwungGridReload,
         setSchwungGridMode, countTripKinds } from './harness.mjs';
import { dumpFixture } from '../dump-fixture.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: schwung pad press — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nTest: a pad press covers its page in ONE bulk request');
{
    /*
     * THE GESTURE, IN THE ONE UNIT THE DEVICE AGREES WITH. On device the pad
     * press added +0.3 single `host_module_get_param` reads a tick across the
     * press section, and the worst frame in the window went 14 -> 20.5 ms —
     * while the `off` arm, movy's own bank switch, cost nothing at all. `mget`
     * is the single-key read, `shadow_get_params` is the bulk one, and this is
     * the harness's own counter over exactly those two.
     *
     * Schwung's `goToPage` runs `warmCurrentPage()` synchronously, and that asks
     * for every cell of the arriving page it does not already hold — one
     * blocking round trip each. The cache cannot cover them on its own:
     * `batchKeys` walks the entries it already has, and a key enters that map
     * only by being asked for, so a page's FIRST read is always live.
     * `focusVoice` knows the page it is about to turn to, which is where the
     * warm is.
     *
     * THE MOCK HAS TO SERVE WHAT THE DEVICE SERVES, or this measures the wrong
     * walk. `warmCurrentPage` STOPS at the first key that answers null, and the
     * device answers "" for a key a module does not serve — a real answer, which
     * the cache keeps — where the mock's store answers null for anything not in
     * the preset, and a null is never cached. Left alone the walk stops after
     * one key and the whole cost this test exists for is invisible; serving a
     * real value for every cell of every page is what the module itself does.
     */
    const jumpFrom = () => {
        setSchwungGridMode('page');
        schwungGridReload();
        env.setParams(MOCK_SYNTHS['6w6']);
        const q = schwungPageFor(0, 'synth');
        for (let i = 0; i < 12 * 60 && !q.ready; i++) q.tick();
        q.goToPage(0);
        for (let i = 0; i < 16; i++) q.tick();
        for (const pg of q.ctl.pages) {
            for (const k of (pg.keys || [])) {
                if (k && !('synth:' + k in env.params)) env.params['synth:' + k] = '0.5';
            }
        }
        return q;
    };

    const p = jumpFrom();
    ok('the page resolved', p.ready);

    /* Onto a page whose cells this session has never read, so nothing below is
     * measuring a page that was already covered. */
    const jump = countTripKinds(() => { p.focusVoice(8); });
    _log(`    (${jump.trips} round trips for the jump: `
       + `${jump.bulk} bulk, ${jump.single} single)`);
    eq('...and it arrived', p.ctl.pages[p.pageIndex].name, 'Clap');

    /* ONE BULK REQUEST FOR THE PAGE, AND NO CELL READ ONE AT A TIME. Without
     * the warm this is the arriving page's eight cells read singly — measured 8
     * here and as the device's +0.3 reads a tick across the press — so the
     * `single` count is what has teeth: the warm does not make the total
     * smaller by accident, it moves the page off the single-key channel. */
    eq('a pad press onto an unread page is one bulk request', jump.bulk, 1);
    /* THE ONE SINGLE IS NOT A CELL. `focusVoice` reads the module's contract
     * first, off the same cache, and rung 1 answers `''` for this rack — a real
     * answer, but not a plan — so rung 2's `ui_pages` is asked for, is not
     * served, and a null is never cached. Every press pays it, warm or not; it
     * is the price of the lookup, not of the page. */
    eq('...and reads no cell of it one at a time', jump.single, 1);

    /* The SECOND press is the control: page 10 is in the cache now, so the same
     * gesture spends nothing on the page at all, and the one single left is the
     * contract read above. A ceiling both presses satisfy would be testing the
     * gesture rather than the warm. */
    const again = countTripKinds(() => { p.focusVoice(8); });
    eq('...and the same press again spends no request on the page', again.bulk, 0);

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: a level with no child-index channel warms the key the controller '
   + 'will read, not the pressed voice (SP-50)');
{
    /* THE ONLY FLEET MODULE THAT REACHES THIS: voice-poc's `pads` declares
     * child_note_base (so it has voices) but no child_index_param (so no
     * channel ever moves `s.childIndex['pads']`). Pinned first so a future
     * dump update that adds the param doesn't quietly make the rest moot. */
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams(dumpFixture('voice-poc'));
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    ok('the rack’s page resolved', p.ready);

    const knobsIdx = p.ctl.pages.findIndex(
        (pg) => pg && pg.level === 'pads' && Array.isArray(pg.keys));
    const pickerIdx = p.ctl.pages.findIndex(
        (pg) => pg && pg.level === 'pads' && !Array.isArray(pg.keys));
    ok('the fixture still has both a pads picker and a pads knobs page',
       knobsIdx >= 0 && pickerIdx >= 0);
    ok('...and the pinned shape: pads declares no child_index_param',
       !(p.ctl.pages[knobsIdx].childLevel || {}).child_index_param);

    /* THE PICKER ALWAYS WINS FIRST MATCH, SO THE WARM NEVER FIRES AS-IS.
     * Schwung's own planner inserts an items-kind picker page ahead of the
     * knobs page for ANY level lacking `child_index_param`
     * (`childPickerNeeded`'s `if (!idxParam) return true`, page_plan.mjs), so
     * `focusVoice`'s first-match-by-level loop lands THERE, and that page
     * carries no `keys` at all -- `jump`'s whole warm block is skipped before
     * `concrete()` ever runs (confirmed empirically while writing this test:
     * on the untouched fixture `focusVoice(5)` reads NOTHING at all). Spliced
     * out here so the fix under test -- which index `concrete()` warms at --
     * is reachable: the real planner cannot produce a first-match knobs page
     * for this shape today, so this exercises movy's own jump/concrete logic
     * in isolation, not a sequence a device press can currently produce. That
     * gap is recorded in the ledger alongside this item, not fixed here --
     * changing which page a press lands on is a different bug. */
    p.ctl.pages.splice(pickerIdx, 1);

    env.restoreParamGlobals();
    const realGet = globalThis.host_module_get_param;
    const gets = [];
    globalThis.host_module_get_param = (k) => { gets.push(k); return realGet(k); };
    /* pad 5 = "Tom Hi" (voicesOf order: kick, snare, hat, reverb (no voice,
     * no note), then the 4 pads children) -- childIndex 1. */
    const pressed = p.focusVoice(5);
    globalThis.host_module_get_param = realGet;

    ok('the press resolved onto the pads page',
       pressed && p.ctl.pages[p.pageIndex].level === 'pads');
    eq('the controller genuinely never moved off instance 0 -- no channel to move it',
       p.ctl.childIndexOf('pads'), 0);
    ok('the warm covers instance 0’s key, which is what will really be read',
       gets.some((k) => k.endsWith('synth:p1_vol')));
    ok('...and NOT the pressed voice’s key, which the controller will never read',
       !gets.some((k) => k.endsWith('synth:p2_vol')));

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: the child-index write adds child_index_base, not a raw index (SP-50)');
{
    /* NO FLEET MODULE EXERCISES THIS. The only dumped module declaring
     * child_index_param (`sophie`) has no note map on either child level, so
     * voicesOf/surfaceOf gives it zero voices and focusVoice never reaches the
     * write. Hand-built so a level has BOTH at once -- costs real-module
     * fidelity, proves the arithmetic only. */
    const hier = {
        pad_layout: 'drums',
        levels: {
            root: { params: [{ level: 'pads', label: 'Pads' }] },
            pads: {
                child_count: 2, child_key_template: 'p{index}_{key}',
                child_index_base: 1, child_index_param: 'focused_pad',
                child_note_base: 60, knobs: ['vol'],
            },
        },
    };
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams({
        'synth:ui_hierarchy': JSON.stringify(hier),
        synth_module: 'sp50-fixture',
        'synth:p1_vol': '0.5', 'synth:p2_vol': '0.5',
        'synth:focused_pad': '1',
    });
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    ok('the synthetic page resolved', p.ready);

    const port = portFor(0);
    const realSet = port.setParam.bind(port);
    const calls = [];
    port.setParam = (k, v) => { calls.push([k, v]); return realSet(k, v); };
    /* pad 2 -> childIndex 1, "instance 2" once child_index_base 1 is added. */
    p.focusVoice(2);
    port.setParam = realSet;

    const wrote = (calls.find(([k]) => k === 'synth:focused_pad') || [])[1];
    eq('the wire value is childIndexToWire(level, childIndex), not String(childIndex)',
       wrote, '2');

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

}
