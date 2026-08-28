/* browser-test/logic/undo-core.mjs — undo/redo core: the stack, grouping, the guard, verbs, applying, toasts
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    readFileSync, readdirSync, sessionTick, resetSetSession, installMockFs, installMockEngine,
    uninstallMockEngine, pushEntry, popUndo, pushRedo, canUndo, canRedo,
    undoDepth, retractEntry, peekUndo, invalidateUndo, takeOrphanedSnaps, resetUndoState,
    MAX_ENTRIES, beginEdit, endEdit, groupOpen, undoTick, onLoopWrap,
    CLOSE, resetUndoGroups, installEditGuard, recordParamOp, seqEdit, seqCtl,
    seqSideEffect, setUndoStrict, takeUndoViolation, resetUndoRecord, isUndoableVerb, isControlVerb,
    UNDOABLE_VERBS, undoOnce, redoOnce, undoWatchContext, resetUndoApply, undoToastVM,
    noteCount, clipTarget, valueChange, seqCmd, takeLabelSync, seqEngineTick,
    resetSeqEngine, appState, ok, eq, notMatch, _log,
    loadPerSetFlags, resetPorts,
} from './harness.mjs';

export async function run() {
/* ── Undo / redo ─────────────────────────────────────────────────────────── */
{
    _log('\nundo — the stack:');
    resetUndoState();
    const entry = (verb, snapBefore) => ({
        verb, target: 'T1', detail: '', paramOps: [], uiOps: [],
        seqSnap: snapBefore === undefined ? undefined : { before: snapBefore, after: -1 },
        setUuid: 'u', engineGen: 1,
    });

    pushEntry(entry('A'));
    pushEntry(entry('B'));
    eq('two entries are on the stack', undoDepth(), 2);
    eq('undo pops newest first', popUndo().verb, 'B');

    resetUndoState();
    pushEntry(entry('A'));
    pushRedo(entry('R'));
    eq('redo stack has an entry', canRedo(), true);
    pushEntry(entry('C'));
    eq('a new edit invalidates redo', canRedo(), false);

    resetUndoState();
    for (let i = 0; i < MAX_ENTRIES + 3; i++) pushEntry(entry('E' + i, i));
    eq('stack is capped at MAX_ENTRIES', undoDepth(), MAX_ENTRIES);
    eq('the oldest entries were evicted', takeOrphanedSnaps().length >= 3, true);

    resetUndoState();
    pushEntry(entry('A', 7));
    pushEntry(entry('B', 8));
    eq('retract removes the matching entry', retractEntry(7), true);
    eq('and only that one', undoDepth(), 1);
    eq('retracting an unknown id is a no-op', retractEntry(99), false);

    /* The engine speaks only for ENGINE state, and reports "no-op" for anything
     * that changed a module or a chain param instead of a note. Dropping those
     * entries wholesale is what made module swaps, LFO assignment and file loads
     * record an undo and then silently discard it. */
    resetUndoState();
    const withModule = entry('LOAD MODULE', 11);
    withModule.moduleOp = {
        slot: 0, componentKey: 'synth', oldWrite: 'a', newWrite: 'b',
        oldIds: ['a'], newIds: ['b'], oldParams: [], leadCount: 0,
    };
    pushEntry(withModule);
    eq('an engine no-op does not drop a module swap', retractEntry(11), false);
    eq('the entry survives', undoDepth(), 1);
    eq('and loses only its snapshot', peekUndo().seqSnap, undefined);

    resetUndoState();
    const withParams = entry('ASSIGN LFO', 12);
    withParams.paramOps = [{ slot: 0, key: 'lfo1:target', old: '', new: 'synth' }];
    pushEntry(withParams);
    eq('nor a param-only edit', retractEntry(12), false);
    eq('which also survives', undoDepth(), 1);

    resetUndoState();
    pushEntry(entry('STEP', 13));
    eq('a genuinely empty entry is still dropped', retractEntry(13), true);
    eq('leaving nothing behind', undoDepth(), 0);

    resetUndoState();
    pushEntry(entry('A', 1));
    pushRedo(entry('B', 2));
    invalidateUndo('test');
    eq('invalidate empties undo', canUndo(), false);
    eq('invalidate empties redo', canRedo(), false);
    eq('and orphans their snapshots', takeOrphanedSnaps().length, 2);
    resetUndoState();
}

{
    _log('\nundo — grouping:');
    const engine = installMockEngine();
    const realNow = Date.now;
    let nowMs = 1000;
    Date.now = () => nowMs;

    const reset = () => { resetUndoState(); resetUndoGroups(); engine.reset(); };

    /* Same key re-enters the open group: one knob turned many detents is one
     * undo, which is the headline grouping requirement. */
    reset();
    beginEdit({ key: 'knob:0:cutoff', verb: 'CUTOFF', close: CLOSE.TOUCH_RELEASE });
    recordParamOp(0, 'synth:cutoff', '0.40', '0.41');
    beginEdit({ key: 'knob:0:cutoff', verb: 'CUTOFF', close: CLOSE.TOUCH_RELEASE });
    recordParamOp(0, 'synth:cutoff', '0.41', '0.42');
    endEdit();
    eq('a held knob is one entry', undoDepth(), 1);
    const held = popUndo();
    eq('with one param op', held.paramOps.length, 1);
    eq('whose old is the pre-gesture value', held.paramOps[0].old, '0.40');
    eq('and whose new is the post-gesture value', held.paramOps[0].new, '0.42');

    /* A different key closes the first group — two knobs are two undos. */
    reset();
    beginEdit({ key: 'knob:0:cutoff', verb: 'CUTOFF', close: CLOSE.TOUCH_RELEASE });
    recordParamOp(0, 'synth:cutoff', '0.40', '0.42');
    beginEdit({ key: 'knob:0:res', verb: 'RES', close: CLOSE.TOUCH_RELEASE });
    recordParamOp(0, 'synth:res', '0.10', '0.20');
    endEdit();
    eq('a second knob makes a second entry', undoDepth(), 2);

    /* No-op suppression: a turn that ends where it started records nothing. */
    reset();
    beginEdit({ key: 'knob:0:cutoff', verb: 'CUTOFF', close: CLOSE.TOUCH_RELEASE });
    recordParamOp(0, 'synth:cutoff', '0.40', '0.41');
    recordParamOp(0, 'synth:cutoff', '0.41', '0.40');
    endEdit();
    eq('a knob returned to its start is no undo', undoDepth(), 0);

    /* IDLE closes a group whose touch release never arrived. */
    reset();
    beginEdit({ key: 'knob:0:cutoff', verb: 'CUTOFF', close: CLOSE.IDLE, idleMs: 500 });
    recordParamOp(0, 'synth:cutoff', '0.40', '0.42');
    nowMs += 100; undoTick();
    eq('an active group stays open', groupOpen(), true);
    nowMs += 600; undoTick();
    eq('an idle group closes itself', groupOpen(), false);
    eq('and pushes its entry', undoDepth(), 1);

    /* LOOP_WRAP: one record pass is one undo, so two loops give two. */
    reset();
    beginEdit({ key: 'rec:0', verb: 'RECORD', close: CLOSE.LOOP_WRAP, seq: true });
    onLoopWrap();
    eq('a rec pass closes at the wrap', undoDepth(), 1);
    beginEdit({ key: 'rec:0', verb: 'RECORD', close: CLOSE.LOOP_WRAP, seq: true });
    onLoopWrap();
    eq('two loops are two undos', undoDepth(), 2);

    /* A seq group snapshots on open and commits on close. */
    reset();
    resetSeqEngine();
    seqEngineTick();   // boot probe: ping matches -> engine ready
    beginEdit({ key: 'step:4', verb: 'STEP', close: CLOSE.IMMEDIATE, seq: true });
    seqEngineTick();   // flush the queued usnap
    const usnap = engine.ops.find(o => o.startsWith('usnap '));
    eq('opening a seq group queues usnap', !!usnap, true);
    const snapId = usnap ? usnap.split(' ')[1] : '-1';
    endEdit();
    seqEngineTick();
    eq('closing it queues ucommit', engine.ops.some(o => o === 'ucommit ' + snapId), true);
    eq('and pushes an entry', undoDepth(), 1);

    /* A group with no param ops and no engine snapshot is not an undo at all. */
    reset();
    beginEdit({ key: 'nothing', verb: 'NOTHING', close: CLOSE.IMMEDIATE });
    endEdit();
    eq('an empty group pushes nothing', undoDepth(), 0);

    Date.now = realNow;
    reset();
    uninstallMockEngine();
}

{
    _log('\nundo — the guard against forgetting:');
    const engine = installMockEngine();
    resetUndoState(); resetUndoGroups(); resetUndoRecord();
    installEditGuard();

    /* Layer 1: a mutating engine command outside a group is reported. */
    takeUndoViolation();
    seqEdit('tog 0 0 60 100');
    notMatch('an ungrouped edit is reported', takeUndoViolation(), /^$/);

    /* …and inside a group it is silent. */
    beginEdit({ key: 'g', verb: 'X', close: CLOSE.IMMEDIATE, seq: true });
    seqEdit('tog 0 0 60 100');
    eq('a grouped edit is clean', takeUndoViolation(), '');
    endEdit();

    /* Control verbs never need a group — transport is not an edit. */
    seqCtl('play');
    seqCtl('watch 1');
    eq('control verbs need no group', takeUndoViolation(), '');

    /* A side effect of an already-recorded edit is not itself an edit. The case
     * that forced this: a module swap drops the automation lanes bound to the
     * outgoing module's params, and giving that cleanup its own entry stacked it
     * ON TOP of the swap — so Undo cleared a lane and left the module alone. */
    beginEdit({ key: 'g2', verb: 'SWAP', close: CLOSE.IMMEDIATE, seq: true });
    endEdit();
    const before = undoDepth();
    seqSideEffect(() => seqEdit('aclr 0 1'));
    eq('a side effect is not reported', takeUndoViolation(), '');
    eq('and pushes no entry of its own', undoDepth(), before);

    /* …and the suppression does not leak past it. */
    seqEdit('tog 0 0 60 100');
    notMatch('the guard is live again afterwards', takeUndoViolation(), /^$/);

    /* An unclassified verb is reported even though it mutates nothing we know. */
    seqCmd('brandnewverb 1');
    notMatch('an unclassified verb is reported', takeUndoViolation(), /^$/);

    /* Strict mode is what the app-loop suite uses to turn these into failures. */
    setUndoStrict(true);
    let threw = false;
    try { seqEdit('del 0 0'); } catch { threw = true; }
    eq('strict mode throws on an ungrouped edit', threw, true);
    setUndoStrict(false);

    resetUndoRecord(); resetUndoGroups(); resetUndoState();
    uninstallMockEngine();
}

{
    _log('\nundo — verb classification matches the engine:');
    /* Layer 2. The UI mirrors command.rs's classification, and a mirror that
     * can drift is worse than none — so read the Rust source and compare. This
     * fails when someone adds an engine command and teaches only one side. */
    const src = readFileSync('engine/crates/seq-core/src/command.rs', 'utf8');
    const body = src.slice(src.indexOf('fn apply_op('), src.indexOf('\n#[cfg(test)]'));
    const dispatched = new Set();
    for (const line of body.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('"') || !t.includes('=>')) continue;
        for (const piece of t.slice(0, t.indexOf('=>')).split('|')) {
            const v = piece.trim().replace(/["\s]/g, '');
            if (v && /^[a-z]+$/.test(v)) dispatched.add(v);
        }
    }
    eq('the Rust dispatch table was parsed', dispatched.size > 40, true);

    const unclassified = [...dispatched].filter(v => !isUndoableVerb(v) && !isControlVerb(v));
    eq('every command.rs verb is classified in verbs.ts: ' + unclassified.join(','),
        unclassified.length, 0);

    /* And the reverse: a UI verb the engine no longer dispatches is dead weight
     * that would silently never fire. */
    const stale = [...UNDOABLE_VERBS].filter(v => !dispatched.has(v));
    eq('no undoable verb is unknown to the engine: ' + stale.join(','), stale.length, 0);

    /* The membership decisions the design turns on. */
    eq('selection is not undoable', isUndoableVerb('clipsel'), false);
    eq('transport is not undoable', isUndoableVerb('play'), false);
    eq('mute is undoable', isUndoableVerb('mute'), true);
    eq('tempo is undoable', isUndoableVerb('bpm'), true);
}

{
    _log('\nundo — applying:');
    const engine = installMockEngine();
    resetUndoState(); resetUndoGroups(); resetUndoApply();
    const writes = [];
    globalThis.shadow_set_param = (slot, key, val) => { writes.push(slot + ':' + key + '=' + val); return true; };
    globalThis.shadow_get_param = () => null;

    /* Param ops undo in reverse: a gesture that wrote A then B must restore B
     * then A, or a later write that depended on an earlier one lands wrong. */
    resetUndoState();
    beginEdit({ key: 'g', verb: 'X', close: CLOSE.IMMEDIATE });
    recordParamOp(0, 'synth:a', '1', '2');
    recordParamOp(0, 'synth:b', '3', '4');
    endEdit();
    writes.length = 0;
    let r = undoOnce();
    eq('undo reports ok', r.ok, true);
    eq('param ops apply in reverse', writes.join(','), '0:synth:b=3,0:synth:a=1');

    /* Redo re-applies forwards. */
    writes.length = 0;
    r = redoOnce();
    eq('redo reports ok', r.ok, true);
    eq('redo re-applies the new values', writes.join(','), '0:synth:b=4,0:synth:a=2');

    /* An empty stack is reported, not silently ignored. */
    resetUndoState();
    r = undoOnce();
    eq('undo on an empty stack is not ok', r.ok, false);
    eq('and says why', r.reason, 'empty');

    /* A seq entry queues uswap AND requests a label sync — without the sync the
     * schwung-side knob_N_set mapping is left pointing at the old param and
     * automation silently drives the wrong thing. */
    resetUndoState(); resetUndoGroups(); engine.reset();
    resetSeqEngine();
    seqEngineTick();                     // boot
    beginEdit({ key: 'g2', verb: 'STEP', close: CLOSE.IMMEDIATE, seq: true });
    seqEdit('tog 0 0 60 100');
    endEdit();
    seqEngineTick();
    takeLabelSync();                     // drain whatever boot left pending
    engine.ops.length = 0;
    undoOnce();
    seqEngineTick();
    eq('undo queues a uswap', engine.ops.some(o => o.startsWith('uswap ')), true);
    eq('undo requests a label sync', takeLabelSync(), true);

    /* Set switch and engine reload both make a snapshot id meaningless. */
    resetUndoState(); resetUndoApply();
    pushEntry({ verb: 'A', target: '', detail: '', paramOps: [{ slot: 0, key: 'k', old: '1', new: '2' }], setUuid: 'u1', engineGen: 1 });
    undoWatchContext();                  // latch the current context
    /* A real set switch, driven through the session: the undo stack is keyed by
     * set uuid, so the entry above belongs to a set we are no longer in. */
    installMockFs({ '/data/UserData/schwung/active_set.txt': 'other-uuid\nOther\n' });
    resetSetSession();
    for (let i = 0; i < 200; i++) { seqEngineTick(); sessionTick(); }
    undoWatchContext();
    eq('a set switch clears the stack', canUndo(), false);

    delete globalThis.shadow_set_param;
    delete globalThis.shadow_get_param;
    resetUndoState(); resetUndoGroups(); resetUndoApply(); resetSetSession();
    uninstallMockEngine();
}

{
    _log('\nundo — toast text:');
    eq('a successful undo names the operation',
        undoToastVM({ ok: true, verb: 'CLEAR CLIP', target: 'T2 CLIP 3', detail: '12 NOTES' }, false).head, 'UNDO');
    eq('redo says REDO',
        undoToastVM({ ok: true, verb: 'CUTOFF', target: 'T1', detail: '' }, true).head, 'REDO');
    eq('target and detail share the bottom line',
        undoToastVM({ ok: true, verb: 'CLEAR CLIP', target: 'T2 CLIP 3', detail: '12 NOTES' }, false).detail,
        'T2 CLIP 3: 12 NOTES');
    eq('an empty stack says so',
        undoToastVM({ ok: false, verb: '', target: '', detail: '', reason: 'empty' }, false).verb, 'NOTHING TO UNDO');
    eq('and distinguishes redo',
        undoToastVM({ ok: false, verb: '', target: '', detail: '', reason: 'empty' }, true).verb, 'NOTHING TO REDO');
    eq('a failure keeps the button name as the head',
        undoToastVM({ ok: false, verb: '', target: '', detail: '', reason: 'empty' }, false).head, 'UNDO');
    eq('drift is called out',
        undoToastVM({ ok: false, verb: '', target: '', detail: '', reason: 'drift' }, false).detail, 'MODULE CHANGED');
    /* The toast is only painted on a frame that renders, and most pages sit
     * idle — an edit whose values did not change on screen (quantize moves
     * notes, not knobs) showed no toast at all until this marked the frame. */
    {
        const { appState } = await import('../../dist/esm/app/state.js');
        const { showUndoToast, undoToastActive, resetUndoToast } =
            await import('../../dist/esm/undo/toast.js');
        resetUndoToast();
        appState.dirty = false;
        showUndoToast({ ok: true, verb: 'QUANTIZE', target: 'T1', detail: '' }, false);
        eq('showing a toast forces a repaint', appState.dirty, true);
        eq('and the toast is up', undoToastActive(), true);
        /* Even a failed undo must repaint — "NOTHING TO UNDO" is the answer. */
        resetUndoToast();
        appState.dirty = false;
        showUndoToast({ ok: false, verb: '', target: '', detail: '', reason: 'empty' }, false);
        eq('a failed undo repaints too', appState.dirty, true);
        resetUndoToast();
    }

    eq('note count is singular at one', noteCount(1), '1 NOTE');
    eq('and plural otherwise', noteCount(12), '12 NOTES');
    eq('clip target reads one-based', clipTarget(1, 2), 'T2 CLIP 3');

    /* The pixel font covers 0x20-0x7E only, so a label with a fancy dash or
     * middot would silently render as gaps. */
    const sample = undoToastVM({ ok: true, verb: 'CUTOFF', target: 'T1', detail: valueChange('0.42', '0.31') }, false);
    const allAscii = [...(sample.head + sample.verb + sample.detail)]
        .every(c => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) <= 0x7E);
    eq('toast text stays inside the font', allAscii, true);
}


{
    _log('\nundo — no param write escapes the chokepoint:');
    /* Guard layer 3. Every user-facing chain-param write goes through
     * chain/set-param.ts so undo records its inverse. The files below write
     * directly on purpose; each is infrastructure or view state, not an edit.
     * A NEW direct write shows up here as a failure rather than as a param
     * that silently cannot be undone. */
    /* Since the TrackPort refactor this list is down to two entries, and that is
     * the point: every track-addressed write now goes through a port, so it will
     * work on a movy-hosted track without revisiting the call site. A direct
     * write would compile and pass on host tracks while silently doing nothing
     * on a movy one — the failure this guard exists to prevent. */
    const ALLOWED = {
        'src/types/schwung.d.ts':       'the ambient declaration',
        'src/track/host-port.ts':       'the host-track door — the one place that talks to a slot',
    };
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = dir + '/' + e.name;
        return e.isDirectory() ? walk(full) : (full.endsWith('.ts') ? [full] : []);
    });
    const offenders = walk('src')
        .filter((f) => !(f in ALLOWED))
        .filter((f) => readFileSync(f, 'utf8').includes('shadow_set_param('));
    eq('no unlisted file writes chain params directly: ' + offenders.join(','),
        offenders.length, 0);

    /* And the allowlist cannot rot into a list of files that no longer write. */
    const stale = Object.keys(ALLOWED)
        .filter((f) => !readFileSync(f, 'utf8').includes('shadow_set_param('));
    eq('no stale allowlist entries: ' + stale.join(','), stale.length, 0);
}


{
    _log('\nundo — module swaps:');
    /* A lane left registered by an earlier block would be excluded from every
     * dump below — the exclusion working, but not what these cases are testing. */
    (await import('../../dist/esm/seq/automation.js')).resetAutomation();
    const { dumpModuleParams } = await import('../../dist/esm/undo/module-dump.js');
    const {
        beginModuleRestore, moduleRestoreTick, moduleRestorePending, resetModuleRestore,
    } = await import('../../dist/esm/undo/module-apply.js');

    /* A schwung SLOT, which is what this fake chain mocks (`shadow_get_param`).
     * The session ticked above created a Set movy had never seen, and a new Set
     * puts tracks 1-4 on movy's own chains — addressed through a different host
     * entirely. Loading an existing set's per-set flags puts track 0 back on the
     * slot this block is about. */
    loadPerSetFlags({});
    resetPorts();

    /* A fake chain slot: chain_params lists what the module exposes, and each
     * key reads back its value. */
    /* `synth_module` not `synth:module`: the device exposes a track slot's
     * loaded id under the underscore alias only (chain/config.ts). */
    const chain = { 'synth_module': 'plaits', 'synth:cutoff': '0.42', 'synth:res': '0.10' };
    const cp = JSON.stringify([
        { key: 'cutoff', type: 'float' }, { key: 'res', type: 'float' },
        { key: 'chain_params' }, { key: 'ui_hierarchy' }, { key: 'name' },
        { key: 'meter', readonly: true },
    ]);
    const writes = [];
    globalThis.shadow_get_param = (slot, key) =>
        key === 'synth:chain_params' ? cp : (chain[key] ?? null);
    globalThis.shadow_set_param = (slot, key, val) => {
        writes.push(key + '=' + val); chain[key] = val; return true;
    };

    const dump = dumpModuleParams(0, 'synth').params;
    eq('a dump covers the module\'s settable params', dump.length, 2);
    eq('and carries their values', dump.find(([k]) => k === 'cutoff')?.[1], '0.42');
    eq('metadata channels are excluded',
        dump.some(([k]) => k === 'chain_params' || k === 'ui_hierarchy' || k === 'name'), false);
    eq('read-only params are excluded', dump.some(([k]) => k === 'meter'), false);

    /* The restore waits for the module to come up before replaying. */
    resetModuleRestore();
    const op = {
        slot: 0, componentKey: 'synth',
        oldWrite: 'plaits', newWrite: 'wurl',
        oldIds: ['plaits'], newIds: ['wurl'],
        oldParams: [['cutoff', '0.42'], ['res', '0.10']], leadCount: 0,
    };
    chain['synth_module'] = 'wurl';        // the swap happened
    beginModuleRestore(op, true);          // undo: waiting for 'plaits'
    writes.length = 0;
    moduleRestoreTick();
    eq('nothing is written while the module is still wrong', writes.length, 0);
    eq('and the restore stays pending', moduleRestorePending(), true);

    chain['synth_module'] = 'plaits';      // the old module is back
    moduleRestoreTick();
    eq('the dump replays once the module is up', writes.length, 2);
    eq('with the recorded values', writes.join(','), 'synth:cutoff=0.42,synth:res=0.10');
    /* The verify round runs before the restore is done — see the staged-replay
     * block below for what it is for. */
    for (let i = 0; i < 40; i++) moduleRestoreTick();
    eq('and the restore completes', moduleRestorePending(), false);

    /* A module that never returns must not hold the stack hostage. */
    resetUndoState(); resetModuleRestore();
    pushEntry({ verb: 'A', target: '', detail: '', paramOps: [], uiOps: [], setUuid: '', engineGen: 0 });
    chain['synth_module'] = 'something-else';
    beginModuleRestore(op, true);
    for (let i = 0; i < 250; i++) moduleRestoreTick();
    eq('a timed-out restore gives up', moduleRestorePending(), false);
    eq('and drops the stack rather than half-applying', canUndo(), false);

    /* Drift: the live module is neither side of the swap, so something changed
     * behind our back (movy can be parked while Move swaps a module). */
    resetUndoState(); resetUndoGroups(); resetUndoApply(); resetModuleRestore();
    const entry = () => ({
        verb: 'LOAD MODULE', target: 'T1', detail: 'WURL',
        paramOps: [], uiOps: [],
        moduleOp: { ...op, oldParams: [] },
        setUuid: '', engineGen: 0,
    });
    pushEntry(entry());
    chain['synth_module'] = 'a-third-module';
    const drift = undoOnce();
    eq('a drifted module refuses to undo', drift.ok, false);
    eq('and says why', drift.reason, 'drift');
    eq('and clears the stack', canUndo(), false);

    /* The reported bug. A track chain slot is SET as `synth:module` but reports
     * its loaded id under the alias `synth_module` (chain/config.ts). Reading
     * the colon form there returns null, which the drift check read as "the
     * module changed behind our back" — so module undo always refused and wiped
     * the stack. The mock answers only the alias, exactly like the device. */
    resetUndoState(); resetUndoGroups(); resetUndoApply(); resetModuleRestore();
    delete chain['synth:module'];
    chain['synth_module'] = 'wurl';        // the module the entry loaded
    pushEntry(entry());
    const ok = undoOnce();
    eq('module undo is not refused when only the alias answers', ok.ok, true);
    eq('and it wrote the old module back', chain['synth:module'], 'plaits');

    /* Hitting Undo before the load has landed still reads the old module. That
     * is a race, not drift — restoring what is already live is a no-op. */
    resetUndoState(); resetUndoGroups(); resetUndoApply(); resetModuleRestore();
    chain['synth_module'] = 'plaits';      // the swap has not taken effect yet
    pushEntry(entry());
    eq('an unlanded load is not treated as drift', undoOnce().ok, true);

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    resetUndoState(); resetUndoGroups(); resetUndoApply(); resetModuleRestore();
}


{
    _log('\nundo — one entry per record pass:');
    const { recPassTick, recToggle, resetRecPass } = await import('../../dist/esm/undo/rec-pass.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const engine = installMockEngine();
    resetUndoState(); resetUndoGroups(); resetRecPass(); resetSeqState();
    resetSeqEngine(); seqEngineTick();

    seqState.lenSteps = 16;

    /* Arming CREATES the clip when the slot is empty (Engine::toggle_record
     * calls ensure_exists), so the snapshot has to be queued before the engine
     * sees `rec`. Taken later — once recording was rolling — it already held the
     * clip, and undoing the first pass removed the notes but left an empty clip
     * behind. */
    engine.ops.length = 0;
    recToggle(0);
    seqEngineTick();
    const ops = engine.ops.filter((o) => /^(usnap|rec)\b/.test(o));
    eq('the snapshot is queued before the rec command', ops[0]?.startsWith('usnap '), true);
    eq('and the rec command follows it', ops[1]?.startsWith('rec '), true);

    /* The group stays open across the count-in — the clip already exists. */
    seqState.countingIn = true;
    recPassTick();
    eq('a pass is open during the count-in', groupOpen(), true);
    eq('and nothing is on the stack yet', undoDepth(), 0);

    seqState.countingIn = false;
    seqState.recording = true;
    seqState.curStep = 0;
    recPassTick();
    for (const step of [4, 8, 12]) { seqState.curStep = step; recPassTick(); }
    eq('advancing within the loop keeps one pass', undoDepth(), 0);

    seqState.curStep = 0;                // wrap
    recPassTick();
    eq('the wrap closes the first pass', undoDepth(), 1);
    eq('and opens the next', groupOpen(), true);
    /* The label carries no pass number: it meant nothing to anyone reading it. */
    const e = popUndo();
    eq('labelled simply RECORD', e.verb, 'RECORD');
    eq('with no pass number', e.detail, '');

    resetUndoState();
    seqState.curStep = 8; recPassTick();
    seqState.curStep = 0; recPassTick();
    eq('a second loop is a second undo', undoDepth(), 1);

    seqState.recording = false;
    recPassTick();
    eq('stopping closes the pass in progress', undoDepth(), 2);
    eq('and leaves no group open', groupOpen(), false);

    /* Arming and disarming before the engine answers must not strand the group.
     * The mirror lags the arm by a poll, so the close waits — but not forever. */
    resetUndoState(); resetRecPass(); resetSeqState();
    recToggle(0);
    eq('the group opens on the press', groupOpen(), true);
    for (let i = 0; i < 60; i++) recPassTick();   // engine never confirms
    eq('an unconfirmed arm gives the group up', groupOpen(), false);

    resetUndoState(); resetUndoGroups(); resetRecPass(); resetSeqState(); resetSeqEngine();
    uninstallMockEngine();

}


}
