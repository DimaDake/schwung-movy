/* browser-test/logic/schwung-page-undo.mjs — a knob turned on a Schwung page
 * is an undoable edit, like the same knob on movy's own pages.
 *
 * Reported from device: "when I turn knobs in the schwung pages they are not
 * recorded into undo stack". The controller writes every cell kind through one
 * `io.setParam`, which went straight to the port, so nothing was journalled.
 *
 * Wire and cell are asserted SEPARATELY (see project_movy-undo-model-refresh):
 * an entry existing, or the DSP going back, does not prove the page shows it.
 *
 * Run by browser-test/logic.mjs.
 */

import { schwungLibAvailable, bootModel, eq, ok, _log, env, portFor, MOCK_SYNTHS,
         setSchwungGridMode, schwungGridReload, resetSeqEngine, installMockEngine,
         uninstallMockEngine, resetUndoState, resetUndoGroups, resetUndoRecord,
         installEditGuard, takeUndoViolation, undoDepth, peekUndo, endEdit,
         undoOnce, recordParamOp, beginEdit, CLOSE } from './harness.mjs';

export async function run() {

/* ── the replay goes to the component's port, not slot N's track ─────────── */
_log('\nlogic: undo of a master FX write reaches the master chain');
{
    const { hostPort, resetPorts } = await import('../../dist/esm/track/registry.js');
    resetPorts();
    resetUndoState(); resetUndoGroups(); resetUndoRecord();
    const host = hostPort(0), track0 = portFor(0);
    const hostWrites = [], trackWrites = [];
    const hs = host.setParam.bind(host), ts = track0.setParam.bind(track0);
    host.setParam = (k, v) => { hostWrites.push(k + '=' + v); return hs(k, v); };
    track0.setParam = (k, v) => { trackWrites.push(k + '=' + v); return ts(k, v); };
    beginEdit({ key: 'm', verb: 'MIX', target: 'MASTER', close: CLOSE.IMMEDIATE });
    recordParamOp(0, 'master_fx:fx1:mix', '0.2', '0.8');
    endEdit();
    undoOnce();
    eq('the inverse is written to the master chain', hostWrites.join(), 'master_fx:fx1:mix=0.2');
    eq('and NOT into track 0 (ch0:master_fx:…)', trackWrites.join(), '');
    host.setParam = hs; track0.setParam = ts;
    resetUndoState(); resetUndoGroups(); resetPorts();
}

if (!schwungLibAvailable()) {
    _log('\nlogic: schwung page undo — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

const { pageOwnerOf } = await import('../../dist/esm/app/page-owner.js');

_log('\nlogic: a Schwung-page knob turn is one undo, and undo moves the cell back');
{
    setSchwungGridMode('page');
    schwungGridReload();
    resetSeqEngine();
    installMockEngine();
    resetUndoState(); resetUndoGroups(); resetUndoRecord();
    installEditGuard(); takeUndoViolation();

    const model = bootModel({
        'synth:name': 'Mock',
        'synth:ui_hierarchy': JSON.stringify({
            levels: { root: { name: 'Main', knobs: ['cutoff', 'wave'], params: ['cutoff', 'wave'] } },
        }),
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
            { key: 'wave', name: 'Wave', type: 'enum', options: ['saw', 'sqr', 'tri'], default: 'saw' },
        ]),
        'synth:cutoff': '0.50',
        'synth:wave': 'saw',
    });
    for (let i = 0; i < 20; i++) model.tick();
    const page = pageOwnerOf(model).page;
    ok('the page is delegated', !!page);
    if (!page) return;
    for (let i = 0; i < 12 * 60 && !page.ready; i++) page.tick();
    eq('the page resolved', page.ready, true);
    const port = portFor(0);

    /* A FAKE CLOCK, because the controller paces writes in real milliseconds
     * (SETPARAM_THROTTLE_MS between writes, RELEASE_COMMIT_IDLE_MS for an
     * enum committed on release) and these ticks take microseconds — the last
     * detent would otherwise still be pending when the test looks. */
    const realNow = Date.now;
    let t = realNow();
    Date.now = () => t;
    const settle = () => { for (let i = 0; i < 40; i++) { t += 50; page.tick(); } };

    /* A float turned over several detents: one gesture, one entry. */
    for (let d = 0; d < 5; d++) { page.knobTurn(0, 1); t += 5; page.tick(); }
    settle();
    ok('the turn reached the DSP', port.getParam('synth:cutoff') !== '0.50');
    eq('no ungrouped write', takeUndoViolation(), '');
    endEdit();
    eq('five detents are ONE undo', undoDepth(), 1);
    eq('named after the param', peekUndo().verb, 'CUTOFF');

    /* An enum is a different cell kind through the same door. */
    page.knobTurn(1, 4);
    settle();
    ok('the enum moved', port.getParam('synth:wave') !== 'saw');
    endEdit();
    eq('a second knob is its own undo', undoDepth(), 2);

    undoOnce();
    settle();
    eq('undo puts the enum back on the wire', port.getParam('synth:wave'), 'saw');
    eq('and in the cell', String(page.ctl.state.values.wave), 'saw');
    undoOnce();
    settle();
    eq('undo puts the float back on the wire', parseFloat(port.getParam('synth:cutoff')), 0.5);
    eq('and in the cell', parseFloat(String(page.ctl.state.values.cutoff)), 0.5);

    Date.now = realNow;
    resetUndoState(); resetUndoGroups(); resetUndoRecord();
    uninstallMockEngine();
    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

}
