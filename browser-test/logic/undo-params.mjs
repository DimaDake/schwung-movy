/* browser-test/logic/undo-params.mjs — undo of params: clip params, rewrite flags, randomisers, LFOs, mute/solo
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    readFileSync, installMockEngine, uninstallMockEngine, popUndo, undoDepth, peekUndo,
    resetUndoState, resetUndoGroups, installEditGuard, takeUndoViolation, resetUndoRecord, undoOnce,
    valueChange, seqEngineTick, resetSeqEngine, SHADOW_UI_SLOTS, appState,
    eq, _log, env,
} from './harness.mjs';

export async function run() {
/* ── Undo / redo — parameter edits ──────────────────────────────────────── */

{
    _log('\nundo — clip params are three separate edits:');
    /* The writers Schwung's Clip Params cells call (SP-53), one per knob. */
    const { applyClipLength, applyClipTranspose, applyClipScaleIdx, clipPageRelease } =
        await import('../../dist/esm/seq/clip-page.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const engine = installMockEngine();
    resetUndoState(); resetUndoGroups(); resetUndoRecord(); resetSeqState();
    resetSeqEngine(); seqEngineTick();
    installEditGuard(); takeUndoViolation();
    seqState.lenSteps = 16;

    /* LENGTH: many writes, one entry, committed on release. */
    for (let i = 0; i < 6; i++) applyClipLength(0, seqState.lenSteps + 1);
    seqEngineTick();
    eq('a clip edit is recorded, not ungrouped', takeUndoViolation(), '');
    eq('and stays open while the knob is turning', undoDepth(), 0);
    clipPageRelease(1, 0);
    eq('the release commits one entry', undoDepth(), 1);
    eq('labelled as the length', popUndo().verb, 'CLIP LENGTH');

    /* Each knob is its own undo — turning TRANSPOSE after LENGTH must not join
     * the length's entry. */
    resetUndoState();
    for (let i = 0; i < 6; i++) applyClipLength(0, seqState.lenSteps + 1);
    for (let i = 0; i < 6; i++) applyClipTranspose(0, seqState.clipTranspose + 1);
    seqEngineTick();
    eq('a second knob closes the first entry', undoDepth(), 1);
    clipPageRelease(2, 0);
    eq('and commits its own', undoDepth(), 2);
    eq('the newest being the transpose', popUndo().verb, 'TRANSPOSE');
    eq('under the length', popUndo().verb, 'CLIP LENGTH');

    /* SCALE is one entry too, and it reaches the engine. */
    resetUndoState();
    applyClipScaleIdx(0, seqState.clipScaleIdx + 1);
    applyClipScaleIdx(0, seqState.clipScaleIdx + 1);
    clipPageRelease(0, 0);
    seqEngineTick();
    eq('the release commits the scale', undoDepth(), 1);
    eq('as its own edit', popUndo().verb, 'CLIP SCALE');
    eq('having reached the engine', engine.ops.some((o) => o.startsWith('cscl')), true);
    eq('with no ungrouped edit anywhere', takeUndoViolation(), '');

    /* A write that lands where it started changes nothing. */
    resetUndoState();
    applyClipScaleIdx(0, seqState.clipScaleIdx);
    clipPageRelease(0, 0);
    eq('an unmoved scale knob is no undo', undoDepth(), 0);

    resetUndoState(); resetUndoGroups(); resetSeqState(); resetSeqEngine();
    uninstallMockEngine();
}

{
    _log('\nundo — params that rewrite the module carry a flag:');
    const { readFileSync: rf } = await import('node:fs');
    const { createDumpBoot } = await import('../dump-boot.mjs');
    const fleet = JSON.parse(rf('docs/module-dump/device-dump.json', 'utf8'));
    const { bootFromDumpEntry } = await createDumpBoot(fleet);
    const wd = bootFromDumpEntry(fleet.modules.find((m) => m.id === 'weird-dreams'));
    const byKey = {};
    for (const p of wd.dumpLayout().params) if (p) byKey[p.key] = p;

    /* A kit or voice preset rewrites everything under it, so its inverse is
     * lossy — the flag is what routes undo to the whole-module snapshot. */
    eq('the kit is a preset', byKey.kit?.renderStyle, 'preset');
    eq('and captures module state', byKey.kit?.capturesModuleState, true);
    eq('the voice preset is a preset', byKey.cv_preset?.renderStyle, 'preset');
    eq('and captures module state', byKey.cv_preset?.capturesModuleState, true);

    /* Randomisers rewrite the module wholesale — the same reason, and they are
     * one-shot actions rather than values. */
    for (const k of ['rnd_kit', 'rnd_voice', 'rnd_pitch']) {
        eq(k + ' is a trigger', byKey[k]?.behavior, 'trigger');
        eq(k + ' captures module state', byKey[k]?.capturesModuleState, true);
        eq(k + ' is not automatable', byKey[k]?.automatable, false);
    }

    /* An ordinary param must NOT pay the cost — see KnobSlot.capturesModuleState
     * for what it costs and why it is opt-in. */
    eq('a plain knob does not capture state', byKey.cv_cutoff?.capturesModuleState, false);
    eq('nor does a plain FX knob', byKey.rev_mix?.capturesModuleState, false);

    /* The boot above replaced `os` and `host_read_file` with the dump's own and
     * nothing else puts the env's back, so a suite that boots a dump gives them
     * back before it returns — this is the whole of what the old suite-order
     * constraint in logic.mjs was working around. */
    env.restoreHostGlobals();
}

{
    _log('\nundo — a loaded file is named by its last path segment:');
    const { valueChange } = await import('../../dist/esm/undo/label.js');
    /* The overlay trims from the END, so a full path left whole loses exactly
     * the part that identifies the file. */
    eq('a sample path shows the file name',
        valueChange('/data/UserData/Samples/Kicks/old kick.wav',
                    '/data/UserData/Samples/Snares/snare 909.wav'),
        'old kick.wav -> snare 909.wav');
    eq('an empty side stays empty', valueChange('', '/a/b/c.wav'), ' -> c.wav');
    eq('a plain value is untouched', valueChange('SAW', 'SQUARE'), 'SAW -> SQUARE');
    eq('and a number still loses its wire-format zeros',
        valueChange('0.5000', '1.0000'), '0.5 -> 1');
}


{
    _log('\nundo — an LFO-driven param is not captured, and the assignment is:');
    (await import('../../dist/esm/seq/automation.js')).resetAutomation();
    const { dumpModuleParams, captureLfoAssignments } =
        await import('../../dist/esm/undo/module-dump.js');
    const {
        beginModuleRestore, moduleRestoreTick, resetModuleRestore,
    } = await import('../../dist/esm/undo/module-apply.js');

    const store = {
        'synth:chain_params': JSON.stringify([{ key: 'cutoff' }, { key: 'res' }]),
        'synth:cutoff': '0.73',            // wherever the LFO happens to be
        'synth:res': '0.20',
        'lfo1:target': 'synth', 'lfo1:target_param': 'cutoff', 'lfo1:enabled': '1',
        'lfo2:target': '', 'lfo2:target_param': '', 'lfo2:enabled': '0',
        'synth_module': 'wurl',
    };
    const writes = [];
    globalThis.shadow_get_param = (slot, key) => store[key] ?? null;
    globalThis.shadow_set_param = (slot, key, v) => { writes.push(key + '=' + v); store[key] = v; return true; };
    globalThis.shadow_set_param_timeout = (slot, key, v) => {
        if (!(slot >= 0 && slot < SHADOW_UI_SLOTS)) return false;
        writes.push(key + '=' + v); store[key] = v; return true;
    };

    /* Reading a modulated param yields a phase sample, not a setting — and it
     * could never hold anyway, since the LFO overwrites it every DSP tick. */
    const d = dumpModuleParams(0, 'synth');
    const keys = d.params.map(([k]) => k);
    eq('the LFO-driven param is left out of the dump', keys.includes('cutoff'), false);
    eq('while the rest is captured', keys.includes('res'), true);

    /* An automation lane drives a param exactly as an LFO does — the value read
     * is a playback sample, and the base belongs to movy — so its keys are
     * excluded on the same grounds. model/store.ts treats the two as one class. */
    {
        const { automationRegistry, resetAutomation: resetAuto } =
            await import('../../dist/esm/seq/automation.js');
        resetAuto();
        automationRegistry()[0][0] = { targetParam: 'synth:res', shortName: 'res',
                                       min: 0, max: 1, type: 'float' };
        const withLane = dumpModuleParams(0, 'synth').params.map(([k]) => k);
        eq('an automated param is left out too', withLane.includes('res'), false);
        resetAuto();
        eq('and comes back once the lane is gone',
            dumpModuleParams(0, 'synth').params.map(([k]) => k).includes('res'), true);
    }

    /* An LFO on a DIFFERENT component must not suppress this one's params. */
    store['lfo1:target'] = 'fx1';
    eq('an LFO pointed elsewhere suppresses nothing',
        dumpModuleParams(0, 'synth').params.map(([k]) => k).includes('cutoff'), true);
    store['lfo1:target'] = 'synth';

    /* The assignment itself lives outside <component>:state — schwung saves
     * LFOs separately — so a swap strands it unless undo carries it. */
    const lfo = captureLfoAssignments(0, 'synth');
    eq('the pointing LFO is captured', lfo.length, 3);
    eq('including its target param',
        lfo.some(([k, v]) => k === 'lfo1:target_param' && v === 'cutoff'), true);
    eq('an idle LFO is not captured', lfo.some(([k]) => k.startsWith('lfo2')), false);
    eq('a master FX slot has no slot LFOs', captureLfoAssignments(0, 'mfx:fx1').length, 0);

    /* Restoring re-points the LFO — after the params, so the base is in place
     * before the LFO starts swinging around it. */
    resetModuleRestore();
    store['lfo1:target'] = ''; store['lfo1:target_param'] = ''; store['lfo1:enabled'] = '0';
    beginModuleRestore({
        slot: 0, componentKey: 'synth', oldWrite: 'wurl', newWrite: 'rex',
        oldIds: ['wurl'], newIds: ['rex'],
        oldParams: d.params, leadCount: d.leadCount, oldLfo: lfo,
    }, true);
    writes.length = 0;
    for (let i = 0; i < 200; i++) moduleRestoreTick();
    eq('the LFO assignment is restored', store['lfo1:target_param'], 'cutoff');
    eq('and re-enabled', store['lfo1:enabled'], '1');
    const firstLfo = writes.findIndex((w) => w.startsWith('lfo1:'));
    const lastParam = writes.map((w) => w.startsWith('synth:')).lastIndexOf(true);
    eq('and it comes after the params it will drive', firstLfo > lastParam, true);

    delete globalThis.shadow_get_param;
    delete globalThis.shadow_set_param;
    env.restoreSetParamTimeout();
    resetModuleRestore();
}


{
    _log('\nundo — mute and solo are one entry each, and consistent:');
    const {
        toggleMute, toggleSolo, isMuted, isSoloed, anySolo, resetTrackMutes,
    } = await import('../../dist/esm/mixer/track-mutes.js');
    const { seqState: st, resetSeqState: resetSt } = await import('../../dist/esm/seq/state.js');
    const engine = installMockEngine();
    resetUndoState(); resetUndoGroups(); resetUndoRecord(); resetSt(); resetTrackMutes();
    resetSeqEngine(); seqEngineTick();
    installEditGuard(); takeUndoViolation();

    /* Solo derives EVERY track's mute, so it moves up to four at once. Each
     * used to open its own entry — four undos for one press, and undoing them
     * singly left the engine's mutes disagreeing with the solo latch. */
    toggleSolo(1);
    seqEngineTick();
    eq('one solo press is one entry', undoDepth(), 1);
    eq('not one per track it muted', undoDepth() < 4, true);
    eq('and nothing escaped the guard', takeUndoViolation(), '');
    eq('the solo took effect', isSoloed(1), true);
    eq('silencing the others', st.muted[0], true);
    eq('but not itself', st.muted[1], false);
    eq('labelled as a solo', peekUndo().verb, 'SOLO');

    /* Undo has to put BOTH halves back — the engine's mutes and movy's own solo
     * bookkeeping — or they describe different worlds. */
    undoOnce();
    eq('undo clears the solo latch', anySolo(), false);
    eq('and queues the engine mutes back', engine.ops.some((o) => o.startsWith('mute ')), true);

    /* A plain mute is still one entry, and still undoable. */
    resetUndoState(); resetTrackMutes(); resetSt();
    toggleMute(2);
    seqEngineTick();
    eq('a mute is one entry too', undoDepth(), 1);
    eq('labelled as a mute', peekUndo().verb, 'MUTE');
    eq('and it muted', isMuted(2), true);
    engine.ops.length = 0;
    undoOnce();
    seqEngineTick();
    /* The two halves are restored by different mechanisms: the engine's mutes
     * come back with the snapshot (a uswap — the mock does not replay engine
     * state, so seqState.muted stays where it was here), and movy's own
     * bookkeeping comes back with the ui op. */
    eq('undo queues the engine half', engine.ops.some((o) => o.startsWith('uswap ')), true);
    eq('and leaves no stray solo latch', anySolo(), false);

    /* Muting while a solo is up edits the held base, not the derived mute —
     * still one entry. */
    resetUndoState(); resetTrackMutes(); resetSt();
    toggleSolo(0);
    resetUndoState();
    toggleMute(3);
    seqEngineTick();
    eq('a mute under a solo is one entry', undoDepth(), 1);
    eq('and is remembered underneath', isMuted(3), true);
    undoOnce();
    eq('undoing it restores the base', isMuted(3), false);
    eq('leaving the solo alone', isSoloed(0), true);

    resetUndoState(); resetUndoGroups(); resetTrackMutes(); resetSt(); resetSeqEngine();
    uninstallMockEngine();
}

}
