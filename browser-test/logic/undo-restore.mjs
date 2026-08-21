/* browser-test/logic/undo-restore.mjs — undo of module swaps and presets: button LEDs, restore ordering, state blobs
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    createModel, portFor, MOCK_SYNTHS, installMockEngine, uninstallMockEngine, popUndo,
    undoDepth, peekUndo, resetUndoState, beginEdit, endEdit, groupOpen,
    CLOSE, resetUndoGroups, installEditGuard, recordParamOp, takeUndoViolation, isUndoableVerb,
    isControlVerb, undoOnce, redoOnce, resetUndoApply, valueChange, seqEngineTick,
    resetSeqEngine, appState, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── Undo / redo — module swaps, presets and the button LEDs ────────────── */

{
    _log('\nbuttons — dim means pressable, bright means pressed:');
    const { setButtonHeld, buttonHeld, resetButtonHeld } =
        await import('../../dist/esm/seq/button-held.js');
    const { cachedSetButtonLED, seqLedsInvalidate: resetLedCache, ledFrameReset } =
        await import('../../dist/esm/seq/led-cache.js');
    const { undoLedColor } = await import('../../dist/esm/seq/buttons.js');
    const WHITE_OFF = 0, WHITE_DIM = 16, WHITE_BRIGHT = 124;

    const sent = {};
    const realSet = globalThis.setButtonLED;
    globalThis.setButtonLED = (cc, color) => { sent[cc] = color; };

    /* The rule lives in one place, so it applies to every button rather than
     * only the two that used to thread a `pressed` flag. */
    resetButtonHeld(); resetLedCache(); ledFrameReset();
    cachedSetButtonLED(51, WHITE_DIM);
    eq('a pressable button rests dim', sent[51], WHITE_DIM);

    setButtonHeld(51, true);
    resetLedCache(); ledFrameReset();
    cachedSetButtonLED(51, WHITE_DIM);
    eq('and goes bright under the finger', sent[51], WHITE_BRIGHT);

    /* A button that does nothing must not light up when pressed. */
    resetLedCache(); ledFrameReset();
    setButtonHeld(52, true);
    cachedSetButtonLED(52, WHITE_OFF);
    eq('a dark button stays dark while held', sent[52], WHITE_OFF);

    /* One already bright for a state reason is left alone. */
    resetLedCache(); ledFrameReset();
    setButtonHeld(58, true);
    cachedSetButtonLED(58, WHITE_BRIGHT);
    eq('a state-bright button is unaffected', sent[58], WHITE_BRIGHT);

    resetButtonHeld();
    resetLedCache(); ledFrameReset();
    cachedSetButtonLED(51, WHITE_DIM);
    eq('releasing returns it to dim', sent[51], WHITE_DIM);
    eq('and the held set is empty', buttonHeld(51), false);

    /* Undo advertises with dim, not bright — bright is reserved for the press. */
    eq('undo dim when there is something to undo',
        undoLedColor(true, false, false), WHITE_DIM);
    eq('undo dark when the stack is empty',
        undoLedColor(false, false, false), WHITE_OFF);
    eq('under Shift it advertises redo instead',
        undoLedColor(false, true, true), WHITE_DIM);
    eq('and stays dark under Shift with nothing to redo',
        undoLedColor(true, false, true), WHITE_OFF);

    globalThis.setButtonLED = realSet;
    resetButtonHeld(); resetLedCache();
}


{
    _log('\nundo — capture and preset (reported broken):');
    const engine = installMockEngine();
    const { captureButton, captureDismiss, setCaptureStateForTest, resetCapture } =
        await import('../../dist/esm/seq/capture.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetUndoState(); resetUndoGroups(); resetUndoApply(); resetSeqState();
    resetSeqEngine(); seqEngineTick();
    installEditGuard(); takeUndoViolation();

    /* Capture writes the buffered phrase into the clip, so it is an edit — it
     * was classified as a control verb and recorded nothing. */
    eq('cap is an undoable edit', isUndoableVerb('cap'), true);
    eq('capsel is an undoable edit', isUndoableVerb('capsel'), true);
    eq('capdone stays control', isControlVerb('capdone'), true);
    eq('capclr stays control', isControlVerb('capclr'), true);

    seqState.capPending = 6;
    captureButton(false);
    seqEngineTick();
    eq('capture is recorded, not silently dropped', takeUndoViolation(), '');
    eq('and the group is open across the overlay', groupOpen(), true);
    setCaptureStateForTest({ overlay: 'select' });
    captureDismiss();
    seqEngineTick();
    eq('dismissing the overlay closes the capture entry', undoDepth(), 1);
    const cap = popUndo();
    eq('labelled as a capture', cap.verb, 'CAPTURE');
    eq('with the phrase size', cap.detail, '6 NOTES');

    resetCapture(); resetSeqState(); resetUndoState(); resetUndoGroups();
    uninstallMockEngine();
}

{
    _log('\nundo — a restored param reaches the on-screen knob:');
    /* Undo writes straight into the DSP, which is what the sound needs — but
     * movy's knobs read a mirror that only re-reads on a slow round robin, so
     * without a targeted refresh the screen kept showing the value undo had
     * just taken back. That is what "undo doesn't work" looked like. */
    const store = { ...MOCK_SYNTHS.moog, 'synth:preset': '0' };
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => { store[key] = v; return true; };
    globalThis.shadow_get_ui_slot = () => 0;

    const { createModel } = await import('../../dist/esm/model/index.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    const { moduleRestoreTick, resetModuleRestore } =
        await import('../../dist/esm/undo/module-apply.js');
    resetUndoState(); resetUndoGroups(); resetUndoApply(); resetModuleRestore();

    const m = createModel(portFor(0), 'synth');
    m.reset();
    for (let i = 0; i < 40; i++) m.tick();
    appState.trackModels[0] = [m];

    const presetVm = () => m.getViewModel().rows.flat().find((p) => p && p.renderStyle === 'preset');
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, 6);
    for (let i = 0; i < 4; i++) m.tick();
    endEdit();
    eq('turning the preset knob wrote to the chain', store['synth:preset'] !== '0', true);
    eq('and recorded an undo entry', undoDepth(), 1);
    const shown = presetVm()?.displayValue;

    undoOnce();
    /* With no `<component>:state` blob this module falls back to a param dump,
     * which is replayed in stages (preset first, then the params it rewrites) —
     * so the restore lands over the next ticks rather than inside undoOnce. */
    for (let i = 0; i < 120; i++) { moduleRestoreTick(); m.tick(); }
    eq('undo restored the chain value', store['synth:preset'], '0');
    eq('and the knob on screen followed it now, not seconds later',
        presetVm()?.displayValue !== shown, true);

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    delete globalThis.shadow_get_ui_slot;
    appState.trackModels[0] = [];
    resetUndoState(); resetUndoGroups(); resetUndoApply();
}


{
    _log('\nundo — a restored module gets its preset back, in the right order:');
    (await import('../../dist/esm/seq/automation.js')).resetAutomation();
    const { dumpModuleParams, paramTier } = await import('../../dist/esm/undo/module-dump.js');
    const {
        beginModuleRestore, moduleRestoreTick, moduleRestorePending, resetModuleRestore,
    } = await import('../../dist/esm/undo/module-apply.js');

    /* Real shapes from docs/module-dump/device-dump.json. airwindows is the
     * `clap` module: plugin_index picks the plugin behind param_0..5, so the
     * params mean nothing until it is set. osirus is the Virus: rom_index and
     * bank_index decide which list `preset` even indexes into. */
    eq('a plugin selector sorts first (airwindows)', paramTier('plugin_index', 'plugin_index'), 0);
    eq('a ROM selector sorts first (virus)', paramTier('rom_index', 'preset'), 0);
    eq('a bank selector sorts first (virus)', paramTier('bank_index', 'preset'), 0);
    eq('the declared list_param is the preset tier', paramTier('preset', 'preset'), 1);
    eq('a module calling it program is too', paramTier('program', 'program'), 1);
    eq('an ordinary param sorts last', paramTier('cutoff', 'preset'), 2);
    /* The params go last so the user's own edits win over what the preset
     * re-applied — that is the whole point of the ordering. */
    eq('and so do the params a preset rewrites', paramTier('param_0', 'plugin_index'), 2);

    /* Replaying an action would not restore state, it would DO something —
     * randomise the patch, or overwrite a preset slot. */
    const store = {
        'synth:chain_params': JSON.stringify([
            { key: 'rom_index' }, { key: 'preset' }, { key: 'cutoff' },
            { key: 'rnd_patch' }, { key: 'save_preset' }, { key: 'reset_patch' },
            { key: 'preset_count' },
        ]),
        'synth:ui_hierarchy': JSON.stringify({ levels: { root: { list_param: 'preset' } } }),
        'synth:rom_index': '2', 'synth:preset': '7', 'synth:cutoff': '0.42',
        'synth:rnd_patch': '1', 'synth:save_preset': '1', 'synth:reset_patch': '1',
        'synth:preset_count': '128',
    };
    const writes = [];
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); store[key] = v; return true; };

    const d = dumpModuleParams(0, 'synth');
    const keys = d.params.map(([k]) => k);
    eq('the dump is ordered selector, preset, then the rest',
        keys.join(','), 'rom_index,preset,cutoff');
    eq('and marks where the preset tier ends', d.leadCount, 2);
    eq('randomise is never replayed', keys.includes('rnd_patch'), false);
    eq('nor is save', keys.includes('save_preset'), false);
    eq('nor is reset', keys.includes('reset_patch'), false);
    eq('preset_count is metadata, not a value', keys.includes('preset_count'), false);

    /* The staged replay. */
    resetModuleRestore();
    const op = {
        slot: 0, componentKey: 'synth', oldWrite: 'osirus', newWrite: 'wurl',
        oldIds: ['osirus'], newIds: ['wurl'],
        oldParams: d.params, leadCount: d.leadCount,
    };
    store['synth_module'] = 'wurl';
    beginModuleRestore(op, true);
    writes.length = 0;
    moduleRestoreTick();
    eq('nothing is written while the wrong module is loaded', writes.length, 0);

    /* A module can report its id before publishing any params — Virus loads a
     * ROM first — and a dump written into that gap is dropped entirely. */
    store['synth_module'] = 'osirus';
    const realCp = store['synth:chain_params'];
    store['synth:chain_params'] = '[]';
    moduleRestoreTick();
    eq('nor while the module has published no params yet', writes.length, 0);
    eq('the restore is still pending', moduleRestorePending(), true);

    store['synth:chain_params'] = realCp;
    moduleRestoreTick();
    eq('the selector and preset go first', writes.join(','),
        'synth:rom_index=2,synth:preset=7');
    eq('and the rest waits for the preset to settle', moduleRestorePending(), true);

    /* The DSP rewrites params while the preset applies — airwindows does it
     * after the change lands. Our values must be written after that, not into
     * the middle of it. */
    store['synth:cutoff'] = '0.99';   // the preset stomping the user's value
    writes.length = 0;
    for (let i = 0; i < 60; i++) moduleRestoreTick();
    eq('the user\'s own params are written after the settle',
        writes.join(','), 'synth:cutoff=0.42');
    eq('so the preset does not win over them', store['synth:cutoff'], '0.42');

    /* A fixed settle is a guess about someone else's timing, and a wrong guess
     * is silent. A preset whose rewrite lands LATE — after our values — is put
     * right by the verify pass instead of quietly winning. */
    store['synth:cutoff'] = '0.99';   // the preset landing late, after our write
    writes.length = 0;
    for (let i = 0; i < 40; i++) moduleRestoreTick();
    eq('a late preset rewrite is corrected', store['synth:cutoff'], '0.42');
    eq('and only the drifted param is rewritten', writes.join(','), 'synth:cutoff=0.42');
    for (let i = 0; i < 40; i++) moduleRestoreTick();
    eq('the restore completes once the values hold', moduleRestorePending(), false);

    /* The DSP echoes values in its own formatting, so a textual compare would
     * call every float a mismatch and rewrite the whole dump every round. */
    resetModuleRestore();
    store['synth:cutoff'] = '0.4200000';
    store['synth:rom_index'] = '2'; store['synth:preset'] = '7';
    beginModuleRestore(op, true);
    writes.length = 0;
    for (let i = 0; i < 200; i++) moduleRestoreTick();
    eq('a differently-formatted echo is not treated as drift',
        writes.filter((w) => w.startsWith('synth:cutoff')).length, 1);

    /* A param that will not hold its value must not loop forever. */
    resetModuleRestore();
    const stubborn = { ...op, oldParams: [['locked', '1']], leadCount: 0 };
    store['synth:locked'] = '0';
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); return true; };
    beginModuleRestore(stubborn, true);
    writes.length = 0;
    for (let i = 0; i < 400; i++) moduleRestoreTick();
    eq('a param that never holds gives up rather than looping',
        moduleRestorePending(), false);
    eq('after a bounded number of attempts', writes.length <= 4, true);
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); store[key] = v; return true; };
    eq('and the restore completes', moduleRestorePending(), false);

    /* airwindows (`clap`): plugin_index is DECLARED in the hierarchy but never
     * published in chain_params, so a dump built from chain_params alone would
     * restore param_0..5 into whichever plugin happened to be loaded. */
    const aw = {
        'synth:chain_params': JSON.stringify([{ key: 'param_0' }, { key: 'param_1' }]),
        'synth:ui_hierarchy': JSON.stringify({ levels: { root: { list_param: 'plugin_index' } } }),
        'synth:plugin_index': '12', 'synth:param_0': '0.3', 'synth:param_1': '0.7',
    };
    globalThis.shadow_get_param = (slot, key) => aw[key] ?? null;
    const awd = dumpModuleParams(0, 'synth');
    eq('a declared selector missing from chain_params is still captured',
        awd.params.map(([k]) => k).join(','), 'plugin_index,param_0,param_1');
    eq('and it leads', awd.leadCount, 1);

    /* A ROM contains banks, so it must be selected before them. */
    const virus = {
        'synth:chain_params': JSON.stringify([
            { key: 'bank_index' }, { key: 'rom_index' }, { key: 'preset' }, { key: 'gain' },
        ]),
        'synth:ui_hierarchy': JSON.stringify({ levels: { root: { list_param: 'preset' } } }),
        'synth:bank_index': '1', 'synth:rom_index': '2', 'synth:preset': '7', 'synth:gain': '0.5',
    };
    globalThis.shadow_get_param = (slot, key) => virus[key] ?? null;
    const vd = dumpModuleParams(0, 'synth');
    eq('the ROM is selected before the bank it contains',
        vd.params.map(([k]) => k).join(','), 'rom_index,bank_index,preset,gain');
    eq('with all three leading', vd.leadCount, 3);

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    resetModuleRestore();
}


{
    _log('\nundo — adding and removing a module (not just swapping):');
    const {
        beginModuleRestore, moduleRestoreTick, moduleRestorePending, resetModuleRestore,
    } = await import('../../dist/esm/undo/module-apply.js');
    const store = {};
    const writes = [];
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); store[key] = v; return true; };
    /* Enough ticks to clear the verify round for restores that write params. */
    const run = (n = 40) => { writes.length = 0; for (let i = 0; i < n; i++) moduleRestoreTick(); };

    /* ADD: an empty slot gains a module. The old side is nothing, so undoing it
     * must wait for the slot to go EMPTY rather than for some module id. */
    resetModuleRestore();
    const addOp = {
        slot: 0, componentKey: 'synth', oldWrite: '', newWrite: 'wurl',
        oldIds: [], newIds: ['wurl'], oldParams: [], leadCount: 0,
    };
    store['synth_module'] = '';
    beginModuleRestore(addOp, true);
    run();
    eq('undoing an add completes on an empty slot', moduleRestorePending(), false);
    eq('and writes no params into it', writes.length, 0);

    /* …and it must not complete while the module is still loaded. */
    resetModuleRestore();
    store['synth_module'] = 'wurl';
    beginModuleRestore(addOp, true);
    run(3);
    eq('but not while the module is still there', moduleRestorePending(), true);

    /* REMOVE: a module is cleared to NONE. Undo brings it back with its values. */
    resetModuleRestore();
    store['synth_module'] = 'wurl';
    store['synth:chain_params'] = JSON.stringify([{ key: 'cutoff' }]);
    store['synth:cutoff'] = '0.0';
    const rmOp = {
        slot: 0, componentKey: 'synth', oldWrite: 'wurl', newWrite: '',
        oldIds: ['wurl'], newIds: [], oldParams: [['cutoff', '0.42']], leadCount: 0,
    };
    beginModuleRestore(rmOp, true);
    run();
    eq('undoing a removal restores the module\'s params', writes.join(','), 'synth:cutoff=0.42');
    eq('and completes', moduleRestorePending(), false);

    /* REDO of a removal empties the slot again — and must NOT replay the old
     * module's values into it. Replay is per direction: each side restores what
     * IT held, and for a removal the new side held nothing. */
    resetModuleRestore();
    store['synth_module'] = '';
    beginModuleRestore(rmOp, false);
    run();
    eq('redoing a removal writes nothing into the emptied slot', writes.length, 0);
    eq('and completes', moduleRestorePending(), false);

    /* Redoing a real swap restores the INCOMING module's own values, captured
     * on the first undo — at record time that module did not exist yet. */
    resetModuleRestore();
    const swapOp = {
        slot: 0, componentKey: 'synth', oldWrite: 'wurl', newWrite: 'rex',
        oldIds: ['wurl'], newIds: ['rex'], oldParams: [['cutoff', '0.42']], leadCount: 0,
        newParams: [['cutoff', '0.91']], newLeadCount: 0,
    };
    store['synth_module'] = 'rex';
    beginModuleRestore(swapOp, false);
    run();
    eq('redo restores the incoming module\'s values, not the outgoing one\'s',
        writes.join(','), 'synth:cutoff=0.91');

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    resetModuleRestore();
}


{
    _log('\nundo — the toast says what changed and which way:');
    const { changeDetail, valueChange } = await import('../../dist/esm/undo/label.js');
    const e = {
        paramOps: [{ old: '0.4200', new: '0.3100' }], uiOps: [],
    };
    /* The result goes last in both directions, so the arrow always points at
     * what the value IS now — the same rendering reads correctly either way. */
    eq('undo shows the value going back', changeDetail(e, true), '0.31 -> 0.42');
    eq('redo shows it going forward again', changeDetail(e, false), '0.42 -> 0.31');
    eq('wire-format trailing zeros are dropped', valueChange('0.5000', '1.0000'), '0.5 -> 1');
    eq('non-numeric values are left alone', valueChange('SAW', 'SQUARE'), 'SAW -> SQUARE');

    /* A module swap names both modules. */
    const m = { paramOps: [], uiOps: [], moduleOp: { oldWrite: 'wurl', newWrite: 'rex' } };
    eq('undoing a swap names the module coming back', changeDetail(m, true), 'rex -> wurl');
    eq('redoing it names the other one', changeDetail(m, false), 'wurl -> rex');
    /* Adding and removing a module read as NONE on the empty side. */
    eq('adding a module reads from NONE',
        changeDetail({ paramOps: [], uiOps: [], moduleOp: { oldWrite: '', newWrite: 'rex' } }, false),
        'NONE -> rex');
    eq('removing one reads to NONE',
        changeDetail({ paramOps: [], uiOps: [], moduleOp: { oldWrite: 'rex', newWrite: '' } }, false),
        'rex -> NONE');
    /* A master FX slot stores a DSP path; the toast shows the module, not the path. */
    eq('a DSP path is shown as its module name',
        changeDetail({ paramOps: [], uiOps: [], moduleOp: {
            oldWrite: '/data/UserData/schwung/modules/audio_fx/belt/dsp.so', newWrite: '' } }, false),
        'belt -> NONE');

    /* A gesture that moved several values at once has no single before/after. */
    eq('a multi-param gesture is summarised',
        changeDetail({ paramOps: [{ old: 'a', new: 'b' }, { old: 'c', new: 'd' }], uiOps: [] }, true),
        '2 VALUES');
    /* An engine-only edit keeps its own wording (there is no value to show). */
    eq('an engine-only edit has no value change', changeDetail({ paramOps: [], uiOps: [] }, true), '');
}


{
    _log('\nundo — a module restores from schwung\'s own state blob:');
    const { captureModuleState } = await import('../../dist/esm/undo/module-dump.js');
    const {
        beginModuleRestore, moduleRestoreTick, moduleRestorePending, resetModuleRestore,
    } = await import('../../dist/esm/undo/module-apply.js');

    /* `<component>:state` is schwung's whole-module save/restore channel — its
     * module presets and per-slot autosave both use it, and it calls writing it
     * back "the verified slot-load path". Preferring it means the DSP applies
     * preset and params together, so there is no ordering to get right. */
    /* chain_params is present because a live module always publishes it — its
     * absence is how a late-loading module (Virus) is detected, and the state
     * path honours that guard too. */
    const store = {
        'synth:state': '{"preset":7,"cutoff":0.42}',
        'synth:chain_params': JSON.stringify([{ key: 'cutoff' }]),
    };
    const writes = [];
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); store[key] = v; return true; };

    eq('a JSON state blob is captured', captureModuleState(0, 'synth'),
        '{"preset":7,"cutoff":0.42}');
    /* Only an EMPTY blob means unsupported. A non-JSON one is still usable:
     * schwung's own slot save keeps it as an opaque string ("State is not JSON
     * (e.g. key=value pairs)") and its recall writes back what it stored, so
     * rejecting it here would drop a module to the lossy param dump for
     * nothing. */
    store['synth:state'] = '';
    eq('an empty blob means unsupported', captureModuleState(0, 'synth'), null);
    store['synth:state'] = 'a=1;b=2';
    eq('a key=value blob is still usable', captureModuleState(0, 'synth'), 'a=1;b=2');

    /* Restoring writes the blob back — one write, no staging. */
    resetModuleRestore();
    const op = {
        slot: 0, componentKey: 'synth', oldWrite: 'obxd', newWrite: 'rex',
        oldIds: ['obxd'], newIds: ['rex'],
        oldState: '{"preset":7,"cutoff":0.42}',
        oldParams: [], leadCount: 0,
    };
    store['synth_module'] = 'obxd';
    beginModuleRestore(op, true);
    writes.length = 0;
    for (let i = 0; i < 5; i++) moduleRestoreTick();
    eq('the whole module is restored in one write',
        writes.join(','), 'synth:state={"preset":7,"cutoff":0.42}');
    eq('with no per-param staging at all', moduleRestorePending(), false);

    /* It still waits for the right module — a blob written into the wrong one
     * would be rejected or, worse, half-applied. */
    resetModuleRestore();
    store['synth_module'] = 'rex';
    beginModuleRestore(op, true);
    writes.length = 0;
    for (let i = 0; i < 5; i++) moduleRestoreTick();
    eq('but not before the right module is up', writes.length, 0);

    /* A module with no state blob keeps the per-param path. */
    resetModuleRestore();
    const legacy = {
        slot: 0, componentKey: 'synth', oldWrite: 'plain', newWrite: 'rex',
        oldIds: ['plain'], newIds: ['rex'],
        oldParams: [['cutoff', '0.42']], leadCount: 0,
    };
    store['synth_module'] = 'plain';
    store['synth:chain_params'] = JSON.stringify([{ key: 'cutoff' }]);
    store['synth:cutoff'] = '0.42';
    beginModuleRestore(legacy, true);
    writes.length = 0;
    for (let i = 0; i < 60; i++) moduleRestoreTick();
    eq('a module without state still replays its params',
        writes.join(','), 'synth:cutoff=0.42');

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    resetModuleRestore();
}


{
    _log('\nundo — a preset change restores the tweaks it discarded:');
    const { recordPresetState } = await import('../../dist/esm/undo/record.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    const { moduleRestoreTick: moduleRestoreTick2, resetModuleRestore: resetMR2 } =
        await import('../../dist/esm/undo/module-apply.js');
    resetMR2();

    /* The scenario: load a preset, tweak a knob, then change preset. Writing
     * the old preset index back would make the DSP re-apply THAT preset's
     * defaults — losing the tweak. Only the state blob carries it. */
    const store = {
        'synth:chain_params': JSON.stringify([{ key: 'preset' }, { key: 'cutoff' }]),
        'synth:state': '{"preset":3,"cutoff":0.90}',   // preset 3, cutoff tweaked to 0.90
        'synth:preset': '3', 'synth:cutoff': '0.90',
    };
    const writes = [];
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); store[key] = v; return true; };
    appState.trackModels[0] = [];

    resetUndoState(); resetUndoGroups(); resetUndoApply();
    beginEdit({ key: 'knob:preset', verb: 'PRESET', target: 'T1', close: CLOSE.IMMEDIATE });
    recordPresetState(0, 'synth');
    recordParamOp(0, 'synth:preset', '3', '9');       // the user picks preset 9
    endEdit();
    eq('a preset change records an entry', undoDepth(), 1);
    eq('carrying the whole module, not just the index',
        peekUndo().stateOp?.oldState, '{"preset":3,"cutoff":0.90}');

    writes.length = 0;
    undoOnce();
    eq('undo restores the module state, not the preset index',
        writes.join(','), 'synth:state={"preset":3,"cutoff":0.90}');
    eq('so the tweak made after loading the preset survives',
        writes.some((w) => w.startsWith('synth:preset=')), false);

    /* Redo IS "pick that preset again", so it takes the ordinary param path —
     * re-applying the new preset's defaults is exactly what the user did. */
    writes.length = 0;
    redoOnce();
    eq('redo picks the preset again', writes.join(','), 'synth:preset=9');

    /* Only preset changes pay for this. An ordinary knob turn keeps its exact,
     * surgical inverse — a whole-module restore would revert params the user
     * never touched, including ones automation and LFOs are driving. */
    resetUndoState(); resetUndoGroups();
    beginEdit({ key: 'knob:cutoff', verb: 'CUTOFF', target: 'T1', close: CLOSE.IMMEDIATE });
    recordParamOp(0, 'synth:cutoff', '0.90', '0.20');
    endEdit();
    eq('an ordinary knob records no module snapshot', peekUndo().stateOp, undefined);
    writes.length = 0;
    undoOnce();
    eq('and undoes surgically', writes.join(','), 'synth:cutoff=0.90');

    /* A module with no state blob dumps its params instead. Lossier than the
     * blob (it only covers what chain_params publishes) but far better than the
     * preset index alone, which would re-apply the preset's defaults and lose
     * the very tweaks this exists to protect. */
    resetUndoState(); resetUndoGroups(); resetMR2();
    store['synth:state'] = '';
    store['synth:preset'] = '3'; store['synth:cutoff'] = '0.90';
    beginEdit({ key: 'knob:preset', verb: 'PRESET', target: 'T1', close: CLOSE.IMMEDIATE });
    recordPresetState(0, 'synth');
    recordParamOp(0, 'synth:preset', '3', '9');
    endEdit();
    eq('a module without state dumps its params instead',
        peekUndo().stateOp?.oldParams?.length > 0, true);
    eq('and the preset leads that dump', peekUndo().stateOp?.oldLeadCount, 1);
    writes.length = 0;
    undoOnce();
    for (let i = 0; i < 120; i++) moduleRestoreTick2();
    eq('undo replays the preset first', writes[0], 'synth:preset=3');
    eq('then the tweak it would have discarded',
        writes.some((w) => w === 'synth:cutoff=0.90'), true);

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    appState.trackModels[0] = [];
    resetUndoState(); resetUndoGroups(); resetUndoApply();
}


}
