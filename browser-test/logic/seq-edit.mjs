/* browser-test/logic/seq-edit.mjs — sequencer editing: full velocity, loop mode, hold-step gestures, copy/delete
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    selectTrack,
    installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine, eq, lastMusicalOp,
    installMockFs, uninstallMockFs, PREFS_PATH, readPrefDefaultQuant, writePrefDefaultQuant,
    _log,
} from './harness.mjs';

export async function run() {
/* ── seq Full Velocity toggle (Shift+Step 10) ────────────────────────────── */
{
    _log('\nseq full velocity:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    const { loadFullVelocityPref } = await import('../../dist/esm/seq/state.js');

    installMockEngine();
    const fs = installMockFs();
    resetSeqEngine(); resetSeqState();
    seqEngineTick(); // ready

    eq('full velocity off by default', seqState.fullVelocity, false);
    // Shift + Step 10 (note 25) toggles it; the event is still claimed.
    eq('shift+step claimed', seqHandleMidi([0x90, 25, 127], true), true);
    eq('full velocity toggled on', seqState.fullVelocity, true);
    seqHandleMidi([0x90, 25, 127], true);
    eq('full velocity toggled off', seqState.fullVelocity, false);

    // A bare step press+release (no shift) toggles a note, not the flag.
    seqHandleMidi([0x90, 25, 127], false);
    seqHandleMidi([0x80, 25, 0], false);
    eq('bare step did not touch full velocity', seqState.fullVelocity, false);

    /* It is a machine preference, not part of a set: it has to come back on the
     * next open, which is what `resetSeqState` + a fresh seed stands in for. */
    writePrefDefaultQuant(70);
    seqHandleMidi([0x90, 25, 127], true);
    eq('the toggle reaches prefs.json',
        JSON.parse(fs.files[PREFS_PATH]).fullVelocity, true);
    eq('and leaves the other preferences alone', readPrefDefaultQuant(), 70);
    resetSeqState();
    eq('a fresh mirror starts off', seqState.fullVelocity, false);
    loadFullVelocityPref();
    eq('full velocity survives a reopen', seqState.fullVelocity, true);

    seqHandleMidi([0x90, 25, 127], true);
    eq('turning it off is durable too',
        JSON.parse(fs.files[PREFS_PATH]).fullVelocity, false);
    resetSeqState(); loadFullVelocityPref();
    eq('and a reopen reads it off', seqState.fullVelocity, false);

    uninstallMockFs();
    // No prefs file at all (host FS unavailable): the toggle still works, it is
    // simply not durable — same contract as every other preference here.
    seqHandleMidi([0x90, 25, 127], true);
    eq('the toggle survives an unwritable prefs file', seqState.fullVelocity, true);

    /* And the seed is actually wired into the open: `init()` is the whole of
     * what runs when the tool is opened, so a reader that is never called there
     * would leave the preference as dead as it was before. */
    installMockFs({ [PREFS_PATH]: JSON.stringify({ fullVelocity: true }) });
    resetSeqState();
    const { init } = await import('../../dist/esm/app/init.js');
    init();
    eq('opening movy seeds full velocity from prefs', seqState.fullVelocity, true);
    uninstallMockFs();

    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── seq loop mode: toggle, set window, double, resize ───────────────────── */
{
    _log('\nseq loop mode:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetLoopMode } = await import('../../dist/esm/seq/loop-mode.js');
    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { resetSeqToast } = await import('../../dist/esm/seq/render.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetLoopMode(); resetStepEdit(); resetSeqToast();
    seqEngineTick(); // ready
    seqState.lenSteps = 32; // 2-bar clip

    // Loop button tap (down then up with no gesture) latches Loop Mode on.
    seqHandleMidi([0xB0, 58, 127], false);
    seqHandleMidi([0xB0, 58, 0], false);
    eq('Loop tap enters Loop Mode', seqState.loopMode, true);

    // Two bars pressed together → loop window [min,max].
    seqHandleMidi([0x90, 16 + 1, 127], false); // bar 1 (index 1)
    seqHandleMidi([0x90, 16 + 3, 127], false); // bar 3
    seqEngineTick();
    eq('two-bar press sets loop window', lastMusicalOp(engine.ops), 'loop 0 16 48');
    eq('optimistic loopStart', seqState.loopStart, 16);
    eq('optimistic lenSteps', seqState.lenSteps, 48);
    seqHandleMidi([0x80, 16 + 1, 0], false);
    seqHandleMidi([0x80, 16 + 3, 0], false);

    // Double-tap one bar → 1-bar loop at that bar.
    seqHandleMidi([0x90, 16 + 2, 127], false);
    seqHandleMidi([0x80, 16 + 2, 0], false);
    seqHandleMidi([0x90, 16 + 2, 127], false); // within double-tap window
    seqEngineTick();
    eq('double-tap sets 1-bar loop', lastMusicalOp(engine.ops), 'loop 0 32 16');
    seqHandleMidi([0x80, 16 + 2, 0], false);

    // Loop + wheel resizes by whole bars (loop currently 1 bar at bar 2).
    seqHandleMidi([0xB0, 58, 127], false);     // hold Loop
    seqHandleMidi([0xB0, 14, 1], false);       // wheel +1 → 2 bars from bar 2
    seqEngineTick();
    eq('Loop+wheel grows the loop', lastMusicalOp(engine.ops), 'loop 0 32 32');
    seqHandleMidi([0xB0, 58, 0], false);       // release; gesture happened → no toggle
    eq('Loop+wheel hold did not toggle mode', seqState.loopMode, true);

    // Shift+Step 15 doubles the loop.
    seqState.loopStart = 0; seqState.lenSteps = 16;
    seqHandleMidi([0x90, 16 + 14, 127], true);
    seqEngineTick();
    eq('Shift+Step15 doubles loop', lastMusicalOp(engine.ops), 'dbl 0');

    // Momentary semantics. resetMomentary + resetLoopMode so press state is clean.
    const { resetMomentary } = await import('../../dist/esm/seq/momentary.js');
    resetMomentary(); resetLoopMode();

    // Clean tap from Note → latches Loop on.
    seqState.loopMode = false;
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=false → loopMode=true
    seqHandleMidi([0xB0, 58, 0], false);   // up: tap (0 ticks elapsed) → latch
    eq('Loop tap from Note latches on', seqState.loopMode, true);

    // Clean tap while already in Loop → toggles back to Note.
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=true
    seqHandleMidi([0xB0, 58, 0], false);   // up: tap → toggle off
    eq('Loop tap while in Loop exits to Note', seqState.loopMode, false);

    // Loop + wheel from Note: the gesture reverts on release (no latch).
    seqState.loopMode = false;
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=false → loopMode=true
    seqHandleMidi([0xB0, 14, 1], false);   // wheel → momentaryGesture
    seqHandleMidi([0xB0, 58, 0], false);   // up: gesture → revert to Note
    eq('Loop+wheel from Note reverts', seqState.loopMode, false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetLoopMode();
}

/* ── seq loop LEDs: bars on the step row ─────────────────────────────────── */
{
    _log('\nseq loop LEDs:');
    const { seqLedsTick, seqLedsInvalidate } = await import('../../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../../dist/esm/seq/state.js');
    const { C_WHITE, C_DARKGREY, trackColor, ANIM_PULSE }
        = await import('../../dist/esm/seq/colors.js');

    /* Bars pulse on the firmware's animation channels now, so the assertions read
     * the raw note-ons (channel = animation) rather than setLED colours. No clock
     * pinning any more either: nothing about a bar's appearance is JS-timed. */
    const msgs = [];
    const origSend = globalThis.move_midi_internal_send;
    globalThis.move_midi_internal_send = (m) => msgs.push(m);

    resetSeqState(); seqLedsInvalidate();
    seqState.loopMode = true;
    selectTrack(0);
    seqState.loopStart = 16;   // loop = bar 1..2
    seqState.lenSteps = 32;
    seqState.barOffset = 1;    // bar 1 is selected
    occToggleStep(16 * 3 + 2); // content in bar 3 — deliberately NOT indicated

    // cachedSetAnimLED establishes the base first and animates on the next tick,
    // so a pulsing bar needs two frames to reach its final state.
    seqLedsTick();
    seqLedsTick();
    const chanOf = (note) => msgs.filter((m) => m[2] === note).map((m) => m[1] & 0x0f);
    const lastColor = (note) => msgs.filter((m) => m[2] === note).at(-1)[3];

    eq('selected in-loop bar pulses (bar 1)', chanOf(17).includes(ANIM_PULSE), true);
    eq('selected bar pulses white', lastColor(17), C_WHITE);
    eq('other in-loop bar pulses on the same channel (bar 2)', chanOf(18).includes(ANIM_PULSE), true);
    eq('active bar pulses the track colour', lastColor(18), trackColor(0));
    eq('bar outside the loop is solid (bar 3)', chanOf(19).every((c) => c === 0), true);
    eq('content in bar 3 is not indicated', lastColor(19), C_DARKGREY);
    eq('bar 0 outside the loop is dark grey', lastColor(16), C_DARKGREY);

    globalThis.move_midi_internal_send = origSend;
    resetSeqState(); seqLedsInvalidate();
}

/* ── seq step editing: hold-step gestures ────────────────────────────────── */
{
    _log('\nseq step editing:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { resetLoopMode } = await import('../../dist/esm/seq/loop-mode.js');
    const { resetSeqToast } = await import('../../dist/esm/seq/render.js');
    const { clearHeldSet } = await import('../../dist/esm/seq/held.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetStepEdit(); resetLoopMode(); resetSeqToast();
        for (let t = 0; t < 4; t++) clearHeldSet(t); // clear white selection between sub-tests
        engine.reset();
    };
    reset();
    seqEngineTick(); // ready

    const lastOp = () => lastMusicalOp(engine.ops);

    // Hold step 3 + Volume turn → velocity edit (note NOT toggled on release).
    seqHandleMidi([0x90, 16 + 3, 127], false);   // hold step 3
    eq('Volume claimed while step held', seqHandleMidi([0xB0, 79, 1], false), true);
    seqEngineTick();
    eq('velocity edit op', lastOp(), 'evel 0 3 3 -1 4');
    seqHandleMidi([0x80, 16 + 3, 0], false);     // release — gesture happened
    seqEngineTick();
    eq('held+edit did not toggle a note', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    // Hold step + wheel → NOT consumed (the wheel navigates param pages now; note
    // length on jog was dropped). + arrow → nudge; + arrow w/ shift → fine.
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 0, 127], false);
    eq('wheel not consumed for length while a step is held', seqHandleMidi([0xB0, 14, 1], false), false);
    seqEngineTick();
    eq('no length op emitted', engine.ops.some(o => o.startsWith('elen')), false);
    seqHandleMidi([0xB0, 63, 127], false);       // right arrow
    seqEngineTick();
    eq('nudge coarse op', lastOp(), 'enudge 0 0 0 -1 2');
    seqHandleMidi([0xB0, 62, 127], true);        // left arrow + shift = fine
    seqEngineTick();
    eq('nudge fine op', lastOp(), 'enudge 0 0 0 -1 -1');
    seqHandleMidi([0x80, 16 + 0, 0], false);

    // Hold step + plus = transpose (melodic). Drum lane disables transpose.
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 5, 127], false);
    eq('plus claimed while step held', seqHandleMidi([0xB0, 55, 127], false), true);
    seqEngineTick();
    eq('transpose op', lastOp(), 'etrn 0 5 5 -1 1');
    seqHandleMidi([0x80, 16 + 5, 0], false);

    // Hold step + pad → toggle that pitch at the step (single step).
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 2, 127], false);   // hold step 2
    seqNotePadPlayed(0, 80, 67, 100);            // pad while held
    seqEngineTick();
    eq('hold-step + pad toggles pitch at step', lastOp(), 'ltog 0 2 67 100');
    seqHandleMidi([0x80, 16 + 2, 0], false);

    // Multi-step hold in Loop Mode: pressing two bars registers both for edits.
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0x90, 16 + 1, 127], false);
    seqHandleMidi([0x90, 16 + 4, 127], false);
    seqHandleMidi([0xB0, 79, 1], false);         // Volume up
    seqEngineTick();
    eq('multi-step (loop mode) velocity edits both bars', engine.ops.filter(o => o.startsWith('evel')).length, 2);
    seqHandleMidi([0x80, 16 + 1, 0], false);
    seqHandleMidi([0x80, 16 + 4, 0], false);
    seqState.loopMode = false;

    // A plain tap (no gesture) DOES toggle a note on release.
    reset(); seqEngineTick();
    seqState.lastPitch[0] = 64; seqState.lastVel[0] = 90;
    seqHandleMidi([0x90, 16 + 7, 127], false);
    seqHandleMidi([0x80, 16 + 7, 0], false);
    seqEngineTick();
    eq('tap toggles a note on release', lastOp(), 'tog 0 7 64 90');

    // Loop Mode: hold a bar + wheel no longer edits note length (length dropped;
    // the wheel falls through to page/chain nav).
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0x90, 16 + 1, 127], false);   // hold bar 1
    eq('loop bar + wheel not consumed for length', seqHandleMidi([0xB0, 14, 1], false), false);
    seqEngineTick();
    eq('no loop-mode length op', engine.ops.some(o => o.startsWith('elen')), false);
    seqHandleMidi([0x80, 16 + 1, 0], false);

    uninstallMockEngine(); reset();
}

/* ── seq copy & delete operations ────────────────────────────────────────── */
{
    _log('\nseq copy & delete:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetEditOps } = await import('../../dist/esm/seq/edit-ops.js');
    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { resetLoopMode } = await import('../../dist/esm/seq/loop-mode.js');
    const { resetSeqToast } = await import('../../dist/esm/seq/render.js');
    const { resetDuplicate } = await import('../../dist/esm/seq/duplicate.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetEditOps(); resetDuplicate();
        resetStepEdit(); resetLoopMode(); resetSeqToast(); engine.reset();
    };
    const lastOp = () => lastMusicalOp(engine.ops);
    reset(); seqEngineTick();

    // Copy held → source step → dest step: copy then paste-replace, no toggles.
    // (The full duplicate-gesture matrix is covered in the 'duplicate gesture'
    // and 'seq router' blocks; here we just confirm the Copy button routes to
    // it and releases cleanly.)
    seqHandleMidi([0xB0, 60, 127], false);     // Copy down
    seqHandleMidi([0x90, 16 + 0, 127], false); // source step 0
    seqHandleMidi([0x90, 16 + 8, 127], false); // dest step 8
    seqHandleMidi([0xB0, 60, 0], false);       // Copy up
    seqEngineTick();
    eq('dup copy then paste', engine.ops.includes('cpy 0 0 0') && engine.ops.includes('pst 0 8'), true);
    eq('dup presses did not toggle notes', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    // Delete tap → delete clip.
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0xB0, 119, 0], false);
    seqEngineTick();
    eq('Delete tap deletes clip', lastOp(), 'clipdel 0');

    // Delete tap while on a later bar refocuses to bar 0, so new steps go to the
    // first bar (not the bar that was on screen when the now-empty clip vanished).
    reset(); seqEngineTick();
    seqState.barOffset = 1;                      // viewing the second bar
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0xB0, 119, 0], false);
    eq('clip delete refocuses to bar 0', seqState.barOffset, 0);

    // Delete + step → delete that step's notes (no clip delete on release).
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);    // Delete down
    seqHandleMidi([0x90, 16 + 5, 127], false); // step 5
    seqEngineTick();
    eq('Delete+step clears the step notes', engine.ops.includes('del 0 5 5 -1'), true);
    eq('Delete+step clears the step automation', engine.ops.includes('aclrstep 0 5'), true);
    seqHandleMidi([0xB0, 119, 0], false);      // release — acted, so no clip delete
    seqEngineTick();
    eq('Delete+step release did not delete clip',
        engine.ops.filter(o => o.startsWith('clipdel')).length, 0);

    // Delete + step in Loop Mode → delete the whole bar.
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0x90, 16 + 2, 127], false); // bar 2
    seqEngineTick();
    eq('Delete+bar clears the bar', engine.ops.includes('del 0 32 47 -1'), true);
    seqHandleMidi([0xB0, 119, 0], false);

    // Delete + drum pad → clear that pitch across the clip.
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);
    seqNotePadPlayed(0, 80, 38, 100);          // pad while Delete held
    seqEngineTick();
    eq('Delete+pad clears the pitch', lastOp(), 'del 0 0 255 38');
    seqHandleMidi([0xB0, 119, 0], false);

    // Step held + Clear → clears that step's automation (no clip delete, no note).
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 7, 127], false); // hold step 7
    seqHandleMidi([0xB0, 119, 127], false);    // Clear down while holding
    seqEngineTick();
    eq('step+Clear clears that step automation', engine.ops.includes('aclrstep 0 7'), true);
    seqHandleMidi([0xB0, 119, 0], false);      // Clear release
    seqHandleMidi([0x80, 16 + 7, 0], false);   // step release
    seqEngineTick();
    eq('step+Clear did not delete the clip', engine.ops.filter(o => o.startsWith('clipdel')).length, 0);
    eq('step+Clear did not toggle a note', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    uninstallMockEngine(); reset();
}

}
