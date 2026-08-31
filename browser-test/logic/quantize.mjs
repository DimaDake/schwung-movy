/* browser-test/logic/quantize.mjs — quantization: prefs, the Shift+Step 16 cycle, and the transient overlay
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    selectTrack,
    installMockFs, uninstallMockFs, quantCandidates, nextQuantCandidate, quantIndexForPct, candidateIndex,
    readPrefDefaultQuant, writePrefDefaultQuant, readPrefFileDir, writePrefFileDir,
    PREFS_PATH, FACTORY_DEFAULT_QUANT, armQuantOverlay, quantOverlayActive,
    quantOverlayTickAt, quantOverlayJog, quantOverlayAction, buildQuantOverlayVM, dismissQuantOverlay, resetQuantOverlay,
    installMockEngine, uninstallMockEngine, peekUndo, resetUndoState, beginEdit, endEdit,
    CLOSE, resetUndoGroups, recordParamOp, undoOnce, resetUndoApply, seqCmd,
    seqEngineTick, resetSeqEngine, appState, ok, eq, lastMusicalOp,
    _log,
} from './harness.mjs';

export async function run() {
/* ── Quantization: machine-level prefs ────────────────────────────────────── */
{
    _log('\nQuantization prefs');

    let fs = installMockFs();
    eq('missing prefs fall back to the factory default',
        readPrefDefaultQuant(), FACTORY_DEFAULT_QUANT);

    writePrefDefaultQuant(70);
    eq('prefs round-trip', readPrefDefaultQuant(), 70);

    uninstallMockFs();
    fs = installMockFs({ [PREFS_PATH]: '{not json' });
    eq('corrupt prefs fall back to the factory default',
        readPrefDefaultQuant(), FACTORY_DEFAULT_QUANT);

    uninstallMockFs();
    fs = installMockFs({ [PREFS_PATH]: JSON.stringify({ defaultQuant: 999 }) });
    eq('out-of-range prefs are clamped', readPrefDefaultQuant(), 100);

    uninstallMockFs();
    fs = installMockFs();
    fs.failWrites = true;
    writePrefDefaultQuant(40);   // must not throw; the value is simply not durable
    ok('a failed prefs write is survivable');
    uninstallMockFs();
}

/* ── Machine-level prefs: per-param browse folders ────────────────────────── */
{
    _log('\nFile-browse folder memory');

    const fs = installMockFs();
    const KIT = '/data/CoreLibrary/Track Presets/Drums/Hybrid';
    const SMP = '/data/CoreLibrary/Samples/Drums/Kick';

    eq('a param with no memory reads null', readPrefFileDir('mrdrums:ui_preset_path'), null);

    writePrefDefaultQuant(70);
    writePrefFileDir('mrdrums:ui_preset_path', KIT);
    writePrefFileDir('mrdrums:pad_sample_path', SMP);

    /* prefs.json was written whole when it held a single setting, so these two
     * kinds of preference used to erase each other. */
    eq('a folder write keeps the quantize default', readPrefDefaultQuant(), 70);
    eq('each param keeps its own folder', readPrefFileDir('mrdrums:ui_preset_path'), KIT);
    eq('a second param does not overwrite the first', readPrefFileDir('mrdrums:pad_sample_path'), SMP);

    writePrefDefaultQuant(30);
    eq('a quantize write keeps the folders', readPrefFileDir('mrdrums:ui_preset_path'), KIT);

    // Bounded, oldest-first: browsing many modules cannot grow the file forever.
    for (let i = 0; i < 70; i++) writePrefFileDir('m' + i + ':k', '/d/' + i);
    const kept = Object.keys(JSON.parse(fs.files[PREFS_PATH]).fileDirs).length;
    eq('stored folders are capped at 64', kept, 64);
    eq('the newest folder survives', readPrefFileDir('m69:k'), '/d/69');
    eq('the oldest folder is evicted', readPrefFileDir('mrdrums:ui_preset_path'), null);
    eq('eviction leaves the quantize default alone', readPrefDefaultQuant(), 30);
    uninstallMockFs();
}

/* ── Quantization: value list and the Shift+Step 16 cycle ─────────────────── */
{
    _log('\nQuantization cycle');

    eq('candidates are 0/def/100',
        JSON.stringify(quantCandidates(70)), JSON.stringify([0, 70, 100]));
    eq('candidates collapse when the default is 0',
        JSON.stringify(quantCandidates(0)), JSON.stringify([0, 100]));
    eq('candidates collapse when the default is 100',
        JSON.stringify(quantCandidates(100)), JSON.stringify([0, 100]));

    eq('cycle advances to the next higher candidate', nextQuantCandidate(0, 70), 70);
    eq('cycle advances past the default', nextQuantCandidate(70, 70), 100);
    eq('cycle wraps from the top', nextQuantCandidate(100, 70), 0);
    eq('cycle from an off-cycle value picks the next higher',
        nextQuantCandidate(40, 70), 70);
    eq('cycle from above the default picks 100', nextQuantCandidate(80, 70), 100);
    eq('cycle wraps with a collapsed candidate list', nextQuantCandidate(100, 0), 0);

    eq('index maps 0%', quantIndexForPct(0), 0);
    eq('index maps 70%', quantIndexForPct(70), 7);
    eq('index maps 100%', quantIndexForPct(100), 10);
    eq('index snaps an off-list value to the nearest', quantIndexForPct(74), 7);

    eq('candidateIndex finds the default', candidateIndex(70, 70), 1);
    eq('candidateIndex reports off-cycle values', candidateIndex(40, 70), -1);
}

/* ── Quantization: the transient overlay ──────────────────────────────────── */
{
    _log('\nQuantize overlay');

    const CC = 0xB0, NOTE = 0x90;
    const STEP_BASE = 16;                 // seq/constants.ts STEP_NOTE_BASE
    const STEP = (n) => STEP_BASE + n;
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const engine = installMockEngine();
    const lastOp = () => lastMusicalOp(engine.ops);

    resetSeqEngine(); resetSeqState(); resetQuantOverlay(); engine.reset();
    seqEngineTick();   // prime: seqCmd only flushes once the engine is ready
    selectTrack(0); seqState.defaultQuant = 70; seqState.clipQuant = 0;

    armQuantOverlay(1000);
    eq('overlay is up after arming', quantOverlayActive(), true);
    eq('overlay survives short of its lifetime', quantOverlayTickAt(2100), false);
    eq('overlay expires at 1200 ms', quantOverlayTickAt(2201), true);
    eq('and is then down', quantOverlayActive(), false);

    armQuantOverlay(1000);
    let vm = buildQuantOverlayVM();
    eq('overlay shows 0/DEF/100',
        JSON.stringify(vm.values), JSON.stringify(['0%', '70%', '100%']));
    eq('overlay marks the default', vm.defIdx, 1);
    eq('overlay boxes the current value', vm.selIdx, 0);

    seqState.defaultQuant = 0;
    vm = buildQuantOverlayVM();
    eq('a 0 default collapses to two values',
        JSON.stringify(vm.values), JSON.stringify(['0%', '100%']));
    eq('and marks nothing', vm.defIdx, -1);

    /* One CC event = one candidate: the jog is read as a direction, the way
     * every other jog consumer in movy reads it. */
    seqState.defaultQuant = 70; seqState.clipQuant = 0;
    armQuantOverlay(1000);
    quantOverlayJog(1, 1100);
    seqEngineTick();
    eq('one jog event selects the next candidate', seqState.clipQuant, 70);
    eq('jog commits it', lastOp(), 'cq 0 70');
    quantOverlayJog(1, 1200); quantOverlayJog(1, 1300);
    eq('jog clamps at the top', seqState.clipQuant, 100);
    quantOverlayJog(-1, 1400); quantOverlayJog(-1, 1500); quantOverlayJog(-1, 1600);
    eq('jog clamps at the bottom', seqState.clipQuant, 0);
    eq('jog re-armed the timer', quantOverlayTickAt(2500), false);
    eq('and it still expires later', quantOverlayTickAt(2801), true);

    /* Input policy. Back and the jog assembly are consumed; anything that
     * neither repaints nor toasts runs underneath without closing it. */
    armQuantOverlay(1000);
    eq('Back is consumed', quantOverlayAction([CC, MoveBack, 127], false), 'dismiss');
    eq('jog turn is jog', quantOverlayAction([CC, MoveMainKnob, 1], false), 'jog');
    eq('jog press is consumed',
        quantOverlayAction([CC, MoveMainButton, 127], false), 'dismiss');
    eq('jog touch is swallowed', quantOverlayAction([NOTE, 9, 127], false), 'swallow');
    eq('Shift+Step 16 advances instead of dismissing',
        quantOverlayAction([NOTE, STEP(15), 127], true), 'through');
    eq('Mute dismisses', quantOverlayAction([CC, 88, 127], false), 'dismiss');
    eq('Shift+Step 5 (page open) dismisses',
        quantOverlayAction([NOTE, STEP(4), 127], true), 'dismiss');
    eq('Shift+Step 10 (Full Vel toast) dismisses',
        quantOverlayAction([NOTE, STEP(9), 127], true), 'dismiss');
    eq('a pad passes through', quantOverlayAction([NOTE, 68, 100], false), 'through');
    eq('a plain step passes through',
        quantOverlayAction([NOTE, STEP(3), 127], false), 'through');
    eq('Play passes through', quantOverlayAction([CC, 85, 127], false), 'through');
    eq('Rec passes through', quantOverlayAction([CC, 86, 127], false), 'through');
    eq('Shift-up does not dismiss', quantOverlayAction([CC, 49, 0], false), 'through');
    eq('a Back release passes through',
        quantOverlayAction([CC, MoveBack, 0], false), 'through');

    dismissQuantOverlay();
    eq('dismiss takes it down', quantOverlayActive(), false);
    resetQuantOverlay(); resetSeqEngine(); resetSeqState();
    uninstallMockEngine();
}


{
    _log('\nundo — a state blob that lies is corrected by the param dump:');
    const { recordPresetState: recPS } = await import('../../dist/esm/undo/record.js');
    const { moduleRestoreTick: mrt, moduleRestorePending: mrp, resetModuleRestore: rmr } =
        await import('../../dist/esm/undo/module-apply.js');
    const { appState: app } = await import('../../dist/esm/app/state.js');
    (await import('../../dist/esm/seq/automation.js')).resetAutomation();

    /* A module whose state round-trip is broken: writing the blob back does NOT
     * reproduce what it reported. weird-dreams is a real instance — its
     * deserializer reads one more master field than its serializer writes, so
     * every field after lands in the wrong slot and it restores to silence.
     * Modelled here by a blob write that mangles a param. */
    const store = {
        'synth:chain_params': JSON.stringify([{ key: 'master' }, { key: 'cutoff' }]),
        'synth:state': 'OPAQUE-BLOB', 'synth:master': '0.80', 'synth:cutoff': '0.42',
    };
    const writes = [];
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => {
        writes.push(key + '=' + v); store[key] = v;
        /* The module bug: applying the blob silences the module. */
        if (key === 'synth:state') { store['synth:master'] = '0'; store['synth:cutoff'] = '0'; }
        return true;
    };
    resetUndoState(); resetUndoGroups(); resetUndoApply(); rmr();
    app.trackModels[0] = [];

    beginEdit({ key: 'k', verb: 'RND', target: 'T1', close: CLOSE.IMMEDIATE });
    recPS(0, 'synth');
    endEdit();
    const op = peekUndo().stateOp;
    eq('both records are kept, not just the blob', op.oldState !== '' && op.oldParams.length > 0, true);

    /* The blob goes on first — it reaches state movy cannot see — and the dump
     * follows only to CHECK it. */
    store['synth:master'] = '0.10'; store['synth:cutoff'] = '0.99';   // randomised
    writes.length = 0;
    undoOnce();
    eq('the blob is applied first', writes[0], 'synth:state=OPAQUE-BLOB');
    eq('and it corrupts the module, as the real one does', store['synth:master'], '0');
    for (let i = 0; i < 200; i++) mrt();
    eq('the verify pass puts the params back', store['synth:master'], '0.80');
    eq('all of them', store['synth:cutoff'], '0.42');
    /* Only the drifted ones are touched — nothing is blanket-rewritten. */
    eq('and the preset is never re-written', writes.some((w) => w.startsWith('synth:preset=')), false);

    /* An in-place repair must not block the next undo — only a module SWAP,
     * which is genuinely still settling, does that. */
    eq('a finished repair leaves undo free', mrp(), false);

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    resetUndoState(); resetUndoGroups(); resetUndoApply(); rmr();
}


{
    _log('\nundo — a JSON state blob supplies the dump values:');
    const { dumpModuleParams } = await import('../../dist/esm/undo/module-dump.js');
    (await import('../../dist/esm/seq/automation.js')).resetAutomation();

    const keys = [];
    for (let i = 0; i < 60; i++) keys.push({ key: 'p' + i });
    const blobObj = { preset: 7 };
    for (let i = 0; i < 60; i++) blobObj['p' + i] = i / 100;

    let reads = 0;
    const store = {
        'synth:chain_params': JSON.stringify([{ key: 'preset' }, ...keys]),
        'synth:ui_hierarchy': JSON.stringify({ levels: { root: { list_param: 'preset' } } }),
    };
    for (const k of Object.keys(blobObj)) store['synth:' + k] = String(blobObj[k]);
    globalThis.shadow_get_param = (slot, key) => { reads++; return store[key] ?? null; };

    /* Reading each param one at a time is what made the first detent of a preset
     * turn stall for the best part of a second on Surge XT (302 params, 884 ms
     * measured on device). The blob already holds every value. */
    reads = 0;
    const viaReads = dumpModuleParams(0, 'synth');
    const readCost = reads;

    reads = 0;
    const viaBlob = dumpModuleParams(0, 'synth', JSON.stringify(blobObj));
    const blobCost = reads;

    eq('both routes capture the same params', viaBlob.params.length, viaReads.params.length);
    eq('and the same values',
        JSON.stringify(viaBlob.params), JSON.stringify(viaReads.params));
    eq('but the blob costs a small fixed number of reads', blobCost < 10, true);
    eq('where per-param reading scales with the module', readCost > 60, true);
    _log(`    (61 params: ${readCost} reads one-at-a-time, ${blobCost} from the blob)`);

    /* A non-JSON blob is not usable as a value source — weird-dreams ships one —
     * so those modules keep the per-param route. */
    reads = 0;
    dumpModuleParams(0, 'synth', 'not-json-at-all');
    eq('a non-JSON blob falls back to reading', reads > 60, true);

    /* A key the blob omits is still read, so coverage never depends on the
     * module having been thorough. */
    const partial = JSON.stringify({ preset: 7, p0: 0.5 });
    reads = 0;
    const viaPartial = dumpModuleParams(0, 'synth', partial);
    eq('a key missing from the blob is read individually',
        viaPartial.params.length, viaReads.params.length);
    eq('and only the missing ones cost a read', reads > 50 && reads < readCost, true);

    delete globalThis.shadow_get_param;
}


{
    _log('\nundo — a blob that works is not overwritten afterwards:');
    const { moduleRestoreTick: mrt2, resetModuleRestore: rmr2 } =
        await import('../../dist/esm/undo/module-apply.js');
    const { appState: app2 } = await import('../../dist/esm/app/state.js');
    const { recordPresetState: recPS2 } = await import('../../dist/esm/undo/record.js');
    (await import('../../dist/esm/seq/automation.js')).resetAutomation();

    /* Surge XT restores correctly from its blob. Replaying the dump on top was
     * actively destructive: the lead is the preset index, so re-writing it made
     * the DSP RELOAD that preset over everything the blob had just restored,
     * then took 300 individual writes while it was mid-load. The instrument came
     * back silent or noisy. */
    const store = {
        'synth:chain_params': JSON.stringify([{ key: 'preset' }, { key: 'cutoff' }, { key: 'res' }]),
        'synth:ui_hierarchy': JSON.stringify({ levels: { root: { list_param: 'preset' } } }),
        'synth:state': '{"preset":7,"cutoff":0.42,"res":0.20}',
        'synth:preset': '7', 'synth:cutoff': '0.42', 'synth:res': '0.20',
    };
    const writes = [];
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => {
        writes.push(key + '=' + v); store[key] = v;
        /* A faithful module: applying the blob restores every param. */
        if (key === 'synth:state') {
            const o = JSON.parse(v);
            for (const k of Object.keys(o)) store['synth:' + k] = String(o[k]);
        }
        return true;
    };
    resetUndoState(); resetUndoGroups(); resetUndoApply(); rmr2();
    app2.trackModels[0] = [];

    beginEdit({ key: 'kk', verb: 'PRESET', target: 'T1', close: CLOSE.IMMEDIATE });
    recPS2(0, 'synth');
    recordParamOp(0, 'synth:preset', '7', '19');
    endEdit();

    store['synth:preset'] = '19'; store['synth:cutoff'] = '0.90';   // the preset change
    writes.length = 0;
    undoOnce();
    for (let i = 0; i < 300; i++) mrt2();

    eq('the blob restored the module', store['synth:cutoff'], '0.42');
    eq('the preset is never re-written', writes.some((w) => w.startsWith('synth:preset=')), false);
    eq('and no param is written after the blob',
        writes.filter((w) => !w.startsWith('synth:state=')).length, 0);

    /* Not even when the module is still settling. A dump PARSED from the blob
     * is the same data the blob holds, so comparing it against a module that
     * just applied that blob measures timing, not correctness — Surge XT was
     * caught mid-patch-load and had 225 params "corrected" into a half-loaded
     * synth. */
    resetUndoState(); resetUndoGroups(); rmr2();
    beginEdit({ key: 'kk2', verb: 'PRESET', target: 'T1', close: CLOSE.IMMEDIATE });
    recPS2(0, 'synth');
    recordParamOp(0, 'synth:preset', '7', '31');
    endEdit();
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); store[key] = v; return true; };
    store['synth:cutoff'] = '0.99';        // module mid-apply: value not there yet
    writes.length = 0;
    undoOnce();
    for (let i = 0; i < 300; i++) mrt2();
    eq('a slow-settling module is left alone',
        writes.filter((w) => !w.startsWith('synth:state=')).length, 0);

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    resetUndoState(); resetUndoGroups(); resetUndoApply(); rmr2();
}

}
