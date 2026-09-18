/* browser-test/logic/page-freshness.mjs — SP-19: once movy has moved a
 * parameter, how soon does the DRAWN page show it?
 *
 * Under `page` Schwung draws and Schwung reads: one key a tick, from a cursor
 * that walks the page and comes back round. movy answers that read from the
 * epoch cache in front of the port (`src/renderer/schwung-page-cache.ts`),
 * whose claim is FRESHNESS — a write movy made is visible on the next read of
 * that key, not whenever the batch next fills. Two writers that reach the page
 * without going through the page's own input path are asserted here, because
 * they are the ones the freshness rule exists for:
 *
 *   1. an automation lane, which writes every tick while the page is drawn —
 *      the page must not look frozen while the sound moves;
 *   2. an undo, which writes the OLD value back after the page drew the new one.
 *
 * The second uses a key the model cannot map, deliberately. In `off` mode the
 * redraw came from `syncParamsToModels` refreshing the model's own knob cell;
 * under `page` that path cannot reach a key the model does not carry, so the
 * cache is the only thing left that can deliver it. With both mechanisms
 * present a pass would not say which one did the work, and the whole point of
 * the item is that the one that does is the drain.
 *
 * Both are guarded on schwungLibAvailable(), like every other page claim here.
 *
 * Run by browser-test/logic.mjs.
 */

import { schwungLibAvailable, eq, ok, _log,
         env, portFor, MOCK_SYNTHS, schwungPageFor, schwungGridReload,
         setSchwungGridMode, createModel, appState,
         beginEdit, recordParamOp, endEdit, undoOnce, CLOSE } from './harness.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: page freshness — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nlogic: page freshness (SP-19)');

function pageFor16() {
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams(MOCK_SYNTHS.test16);
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    return p;
}

_log('\nTest: the arc follows an automation lane on every read of that key');
{
    /* Eight keys, so the cursor reaches a given key only every 9-10 ticks —
     * longer than the 8-tick fill, which means an ARRIVAL bound is useless
     * here: the fill alone puts *a* value in the cell well within a rotation,
     * so "the value turned up" would pass with the write never drained. What
     * tells the two apart is which value the read saw, because the lane writes
     * a DISTINCT value every tick and the fill's copy is already several ticks
     * behind the lane. */
    const p = pageFor16();
    ok('the page resolved', p.ready);
    eq('eight keys, so one rotation is longer than the fill',
       p.ctl.page.keys.length, 8);

    const key = p.ctl.page.keys[0];
    const port = portFor(0);
    let reads = 0, stale = 0, latest = '';

    for (let t = 0; t < 40; t++) {
        latest = (0.02 + (t % 40) * 0.02).toFixed(3);
        port.setParam('synth:' + key, latest);   // exactly what a lane does
        const before = p.ctl.state.values[key];
        p.tick();
        const after = p.ctl.state.values[key];
        if (after === before) continue;          // this tick was another key's stop
        reads++;
        if (after !== latest) stale++;
    }
    _log(`    (${reads} reads of the lane's key, ${stale} of them behind the lane)`);
    ok('the cursor came round at least three times', reads >= 3);
    eq('and every one of them saw the value the lane had just written', stale, 0);

    /* The arcer reads the same `state.values`, so this is the level the knob is
     * drawn from — the page's own arc, not a second opinion about it. */
    for (let i = 0; i < 20 && p.ctl.state.values[key] !== latest; i++) p.tick();
    eq('the drawn arc wears the lane’s last value', p.knobLevels()[0], Number(latest));

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: an undo redraws a page whose key the model cannot map');
{
    /* The model boots on ONE declaration; the page is planned from ANOTHER.
     * That is the `page` divergence in its pure form — the plan is the
     * module's, and the model's own knobs can be a different set — and it is
     * how a real key ends up one `syncParamsToModels` cannot map: it reaches
     * the right model and calls `refreshParamKey('q1')`, which answers no for
     * a model whose knobs are p1..p16. Asserted below, because a test that
     * only ever exercised a mapped key would pass on the model refresh and say
     * nothing about the page. */
    setSchwungGridMode('page');
    schwungGridReload();
    appState.activeTrack.index = 0;
    env.setParams(MOCK_SYNTHS.test16);
    const m = createModel(portFor(0), 'synth');
    m.reload(); m.tick(); m.tick(); for (let i = 0; i < 20; i++) m.tick();
    appState.trackModels[0] = [m];

    env.setParams({ ...MOCK_SYNTHS.test16,
        'synth:ui_hierarchy':
            JSON.stringify({ levels: { root: { name: 'Main', knobs: ['q1', 'q2'] } } }),
        'synth:q1': '0.10', 'synth:q2': '0.20' });
    schwungGridReload();
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    ok('the page resolved', p.ready);
    eq('the plan is the declaration the module published',
       p.ctl.page.keys.join(','), 'q1,q2');
    eq('and the model cannot map the key the undo will rewrite',
       m.refreshParamKey('q1'), false);

    const IO = 'q1', KEY = 'synth:' + IO;
    const port = portFor(0);
    /* One key a tick, plus the page-name stop: two keys is a rotation of three,
     * which is what makes this page able to tell the drain from the fill — the
     * fill is eight ticks away. */
    const ROT = p.ctl.page.keys.length + 1;
    const delays = [];
    let missed = 0, lo = '';

    for (let round = 0; round < 6; round++) {
        const hi = (0.30 + round * 0.05).toFixed(3);
        lo = (0.05 + round * 0.05).toFixed(3);
        port.setParam(KEY, hi);
        beginEdit({ key: 'knob:0:' + IO, verb: 'K', close: CLOSE.TOUCH_RELEASE });
        recordParamOp(0, KEY, lo, hi);
        endEdit();
        for (let i = 0; i < 30 && p.ctl.state.values[IO] !== hi; i++) p.tick();
        if (p.ctl.state.values[IO] !== hi) missed++;

        undoOnce();
        let at = -1;
        for (let i = 1; i <= 30; i++) { p.tick(); if (p.ctl.state.values[IO] === lo) { at = i; break; } }
        delays.push(at);
    }
    _log(`    (undo reached the drawn value after ${delays.join(', ')} ticks; one rotation is ${ROT})`);
    eq('the page drew the edited value before each undo', missed, 0);
    eq('and no undo waited for anything but the cursor coming round',
       delays.filter((d) => d <= 0 || d > ROT + 1).length, 0);
    eq('the drawn arc wears the undone value', p.knobLevels()[0], Number(lo));

    appState.trackModels[0] = [];
    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

}
