/* browser-test/logic/step-entry.mjs — step entry, note length, playhead, and the automation fields on the ViewModel
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    selectTrack,
    MOCK_SYNTHS, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine, eq,
    bootModel, lastMusicalOp, _log,
    settleModel,
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
    /* The step view follows the selected track, so a suite that asserts on the
     * track in an op has to say which one it is on — resetSeqState() cannot,
     * the selection is not sequencer state. */
    selectTrack(0);
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
    seqState.barOffset = 0; seqState.watchLane = -1; selectTrack(0);

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

}
