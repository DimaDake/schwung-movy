/* browser-test/logic/step-entry.mjs — step entry, note length, playhead, and the automation fields on the ViewModel
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    MOCK_SYNTHS, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine, eq,
    bootModel, lastMusicalOp, _log,
} from './harness.mjs';

export async function run() {
/* ── selected-note entry (a step press places the full white selection) ───── */
{
    _log('\nseq selected-note entry:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { setHeldSet } = await import('../../dist/esm/seq/held.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;
    const lastOp = () => lastMusicalOp(engine.ops);

    // Select a 3-note chord (white selection), then enter with no pads held.
    setHeldSet(0, [60, 64, 67]);
    seqState.lastVel[0] = 100;
    seqState.lastPitch[0] = 60;
    seqHandleMidi([0x90, 16 + 2, 127], false);
    seqHandleMidi([0x80, 16 + 2, 0], false);
    seqEngineTick();
    eq('step press enters full selection', lastOp(), 'tog 0 2 60 100 64 100 67 100');

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}

/* ── synth multi-entry (two empty steps held → notes on both) ─────────────── */
{
    _log('\nseq synth multi-entry:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../../dist/esm/seq/state.js');
    const { setHeldSet } = await import('../../dist/esm/seq/held.js');
    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetStepEdit(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;       // melodic
    setHeldSet(0, [60]); seqState.lastVel[0] = 100; seqState.lastPitch[0] = 60;

    // Two EMPTY steps pressed together → BOTH get notes, no length gesture.
    seqHandleMidi([0x90, 16 + 4, 127], false);   // press empty step 4
    seqHandleMidi([0x90, 16 + 6, 127], false);   // press empty step 6 while 4 held
    seqHandleMidi([0x80, 16 + 6, 0], false);     // release → step 6 toggles on
    seqHandleMidi([0x80, 16 + 4, 0], false);     // release → step 4 toggles on
    seqEngineTick();                             // flush queued cmds into engine.ops
    eq('synth multi: step 4 entered', occHasStep(4), true);
    eq('synth multi: step 6 entered', occHasStep(6), true);
    eq('synth multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── length gesture: occupancy gate + end/start toggle ────────────────────── */
{
    _log('\nseq length gesture (occupancy + toggle):');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep, occToggleStep } =
        await import('../../dist/esm/seq/state.js');
    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');

    const engine = installMockEngine();
    const TPS = 24; // ticks per step
    // Flush queued cmds, then return slen ops emitted since the last flush call.
    const slenAfter = () => { seqEngineTick(); return engine.ops.filter((o) => o.startsWith('slen')); };
    const press = (b) => seqHandleMidi([0x90, 16 + b, 127], false);
    const release = (b) => seqHandleMidi([0x80, 16 + b, 0], false);

    // Occupied anchor: first press B=3 → note ends at END of step 3 (4 steps).
    resetSeqEngine(); resetSeqState(); resetStepEdit(); engine.reset(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;
    occToggleStep(0);                 // step 0 has a note (occupied anchor)
    press(0);                          // hold occupied step 0
    press(3);                          // press step 3 → length to END of 3
    eq('length end-of-B: slen = 4 steps', slenAfter().at(-1), `slen 0 0 0 -1 ${4 * TPS}`);
    eq('length gesture: B not entered', occHasStep(3), false);

    // Press same B=3 again (still holding A) → trim to START of step 3 (3 steps).
    release(3); press(3);
    eq('length toggle: slen = 3 steps', slenAfter().at(-1), `slen 0 0 0 -1 ${3 * TPS}`);
    // Press again → back to END (4 steps).
    release(3); press(3);
    eq('length toggle back: slen = 4 steps', slenAfter().at(-1), `slen 0 0 0 -1 ${4 * TPS}`);
    release(3); release(0);

    // Backward press (B <= A) on an occupied anchor → no-op, no entry.
    seqEngineTick(); engine.reset(); resetStepEdit();
    if (!occHasStep(5)) occToggleStep(5);   // ensure step 5 occupied (anchor)
    press(5);
    press(2);                          // B < A
    eq('backward press: no slen', slenAfter().length, 0);
    eq('backward press: step 2 not entered', occHasStep(2), false);
    release(2); release(5);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── step-row length span ────────────────────────────────────────────────── */
{
    _log('\nstep-row length span:');
    const { lengthSpanColor } = await import('../../dist/esm/seq/leds.js');
    const { C_LIGHTGREY, C_DARKGREY, trackColorDim } = await import('../../dist/esm/seq/colors.js');
    // held abs step 2, length 4 → steps 3,4,5 are span (light-grey), step 2 is the held note.
    eq('span step light-grey', lengthSpanColor(4, 2, 4, 0), C_LIGHTGREY); // absStep 4 within [3,5]
    eq('last span step light-grey', lengthSpanColor(5, 2, 4, 0), C_LIGHTGREY);
    eq('held step not span', lengthSpanColor(2, 2, 4, 0), -1);          // -1 = "not a span step"
    eq('past span', lengthSpanColor(6, 2, 4, 0), -1);
    eq('1-step note has no tail', lengthSpanColor(3, 2, 1, 0), -1);
    eq('no hold', lengthSpanColor(4, -1, 0, 0), -1);
    // The tail must be visually distinct from in-clip dim and out-of-clip dark-grey.
    eq('tail grey differs from in-clip dim', C_LIGHTGREY !== trackColorDim(0), true);
    eq('tail grey differs from out-of-clip dark-grey', C_LIGHTGREY !== C_DARKGREY, true);
}

/* ── hold-A-press-B length gesture ──────────────────────────────────────── */
{
    _log('\nhold-A-press-B length:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { editStepDown, setLengthTo, heldStepAbs, resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.barOffset = 0; seqState.watchLane = -1; seqState.watchTrack = 0;

    editStepDown(2);                  // hold step 2 (abs 2)
    eq('heldStepAbs is 2', heldStepAbs(), 2);
    setLengthTo(6);                   // first press of step 6 → ends at END of 6 = 5 steps = 120 ticks
    eq('slen emitted (end of B)', peekSeqCmdQueue().some(c => c === 'slen 0 2 2 -1 120'), true);
    setLengthTo(6);                   // same B again → trim to START of 6 = 4 steps = 96 ticks
    eq('slen emitted (start of B, toggled)', peekSeqCmdQueue().some(c => c === 'slen 0 2 2 -1 96'), true);
    resetStepEdit();
    editStepDown(4);
    eq('B<=A is no-op', setLengthTo(4), false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── playhead position ───────────────────────────────────────────────────── */
{
    _log('\nplayhead position:');
    const { playheadX } = await import('../../dist/esm/seq/render.js');
    const W = 128;
    eq('start at 0', playheadX(0, 0, 32, W), 0);
    eq('mid', playheadX(16 * 24, 0, 32, W), 64);   // half of a 32-step clip
    eq('clamps to width-1', playheadX(999999, 0, 32, W), W - 1);
    eq('empty clip → 0', playheadX(0, 0, 0, W), 0);
    // A loop starting at bar 3 (step 32): the sweep is relative to the WINDOW,
    // so its own first tick is x=0, not the right edge.
    eq('mid-clip loop starts at 0', playheadX(32 * 24, 32 * 24, 32, W), 0);
    eq('mid-clip loop halfway', playheadX(48 * 24, 32 * 24, 32, W), 64);
    eq('before the window clamps to 0', playheadX(0, 32 * 24, 32, W), 0);
}

/* ── batch3 status mirror ────────────────────────────────────────────────── */
{
    _log('\nbatch3 status mirror:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=1 tick=10 step=2 pos=53 len=32 hlen=4 occ=' + '0'.repeat(64));
    eq('posTick parsed', seqState.posTick, 53);
    eq('holdLen parsed', seqState.holdLen, 4);
    parseStatusForTest('hnotes=60.64.67');
    eq('holdNotes parsed (3 pitches)', seqState.holdNotes.length, 3);
    eq('holdNotes[0] = 60', seqState.holdNotes[0], 60);
    parseStatusForTest('hnotes=');
    eq('holdNotes empty string clears array', seqState.holdNotes.length, 0);
}

/* ── visual metronome helper ─────────────────────────────────────────────── */
{
    _log('\nvisual metronome:');
    const { metronomeStep } = await import('../../dist/esm/seq/leds.js');

    eq('beat0 lights step 0',  metronomeStep(0, 0),       true);
    eq('beat0 lights step 3',  metronomeStep(3, 0),       true);
    eq('beat0 dark step 4',    metronomeStep(4, 0),       false);
    eq('beat1 lights step 4',  metronomeStep(4, 96),      true);
    eq('beat3 lights step 12', metronomeStep(12, 96 * 3), true);
    eq('wraps to beat0 at 4 beats', metronomeStep(0, 96 * 4), true);
}

/* ── big font (preset value) ───────────────────────────────────────────── */
_log('\nTest: big preset font metrics');
{
    const { fontWidthBig, BIG_FONT_HEIGHT } = await import('../../dist/esm/font/big.js');
    eq('big font cap-height = 11', BIG_FONT_HEIGHT, 11);
    // Up to 3 preset digits must fit the 32px knob cell (else small-font fallback).
    eq('3 digits fit the cell', fontWidthBig('888') <= 32, true);
}

/* ── preset knob render style ──────────────────────────────────────────── */
_log('\nTest: preset param uses the preset render style');
{
    // obxd_like has 8 root knobs (= KNOBS_PER_PAGE), so the preset gets its own
    // page 0; rows[0][0] is the preset param.
    const vm = bootModel(MOCK_SYNTHS.obxd_like).getViewModel();
    eq('preset knob renderStyle = preset', vm.rows[0][0]?.renderStyle, 'preset');
}

/* ── model exposes per-knob param info for automation ────────────────────── */
_log('\nTest: getKnobParamInfo');
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    const info = m.getKnobParamInfo(0);
    eq('param info present', info !== null, true);
    eq('param info has key', typeof info.key, 'string');
    eq('param info has target', info.target, 'synth');
    eq('param info has automatable flag', typeof info.automatable, 'boolean');
    // Out-of-range knob → null.
    eq('out-of-range knob → null', m.getKnobParamInfo(99), null);
}

/* ── viewmodel carries automation fields ─────────────────────────────────── */
_log('\nTest: viewmodel automation fields');
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    const firstKey = m.getKnobParamInfo(0)?.key;
    // Lane 0 bound to the first param's key, with a lock present.
    const auto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map(),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const vm = m.getViewModel(auto);
    const pv = vm.rows[0][0];
    eq('first param automated dot set', pv.automated, true);
    eq('viewmodel exposes automationHeld', vm.automationHeld, false);
    // No-arg getViewModel → no automation.
    eq('default vm: not automated', m.getViewModel().rows[0][0].automated, false);

    // Held step with a lock on lane 0: the param shows its held-step value
    // INVERTED (touched) instead of the name — even though no knob is physically
    // touched. This is what keeps an automated param highlighted while the step
    // stays held (e.g. after releasing the knob).
    const p0 = m.getKnobParamInfo(0);
    const heldAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: true, poolFull: false,
        heldValues: new Map([[0, p0.max]]),   // lane 0 locked to its max at this step
        liveValues: new Map(),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const heldVm = m.getViewModel(heldAuto).rows[0][0];
    eq('held param shows as touched (not the name)', heldVm.touched, true);
    // displayValue is the held-step value, not the param's short name.
    eq('held param shows a value, not its name', heldVm.displayValue !== heldVm.shortName, true);
    // The on-screen knob ARC must also follow the held value (base cutoff=0.70,
    // held=max=1.0): editing automation moves the knob, like normal editing.
    eq('held param knob arc follows held value (max → nv≈1)',
        Math.round(heldVm.normalizedValue * 100), 100);

    // Live record (no step held): a knob being turned reports a live value; the
    // arc follows it and the cell shows touched, exactly like normal editing.
    const liveAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map([[0, p0.max]]),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const liveVm = m.getViewModel(liveAuto).rows[0][0];
    eq('live-record param knob arc follows live value (max → nv≈1)',
        Math.round(liveVm.normalizedValue * 100), 100);
    eq('live-record param shows as touched', liveVm.touched, true);
}

}
