/* browser-test/logic/track-watch.mjs — which track the sequencer edits
 *
 * The screen/pads/knobs follow `appState.activeTrack`; every step edit follows
 * the engine's watched track. When the two name different tracks you play and
 * hear one module while recording into another track's clip — the bug that
 * made a step-recorded take show up on track 1 after opening movy on track 2.
 *
 * The engine is authoritative: `trk=` comes back in every status poll. So a
 * retarget is only real once the engine has been told, and each case below
 * polls after the gesture rather than reading the mirror straight back.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, _log, lastMusicalOp } from './harness.mjs';

export async function run() {

/* ── opening movy: the sequencer starts on the track Move handed over ────── */
{
    _log('\nthe watched track — movy opens on the track Move selected:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { installMockFs, uninstallMockFs } = await import('../mock-fs.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    const { init } = await import('../../dist/esm/app/init.js');

    const engine = installMockEngine();
    installMockFs();
    const openOn = (slot) => {
        engine.reset(); resetSeqEngine(); resetSeqState();
        globalThis.shadow_get_ui_slot = () => slot;
        init();
        seqEngineTick();   // probe → ready
        seqEngineTick();   // flush the queued cmds, then poll status back
    };

    /* Move had track 2 selected when movy was opened. */
    openOn(1);
    eq('the knobs and pads are on track 2', appState.activeTrack.index, 1);
    eq('and the step row edits track 2', seqState.watchTrack, 1);

    /* The whole point: a step recorded now belongs to the module you can hear.
     * Asserted on the op the engine receives, because that — not the mirror —
     * is what decides which clip the note lands in. */
    seqNotePadPlayed(1, 80, 72, 110);
    seqHandleMidi([0x90, 16, 127], false);
    seqHandleMidi([0x80, 16, 0], false);
    seqEngineTick();
    eq('a step recorded at once goes into track 2\'s clip',
        lastMusicalOp(engine.ops), 'tog 1 0 72 110');

    /* The engine outlives the tool: closing movy leaves the DSP loaded, still
     * watching the track it was told last. Reopening on track 1 must take it
     * back, even though the UI's own mirror already reads 0. */
    engine.status.trk = 2;              // as a previous session left it
    openOn(0);
    eq('reopening on track 1 takes the engine off the old track',
       seqState.watchTrack, 0);
    eq('and the engine agrees', engine.status.trk, 0);

    /* Move can only hand over one of its four slots, but the focus group has to
     * follow the track anyway — the four track buttons address the focused
     * quartet, so a group left behind aims them at other tracks. */
    openOn(3);
    eq('the track buttons address the group the open landed in',
       appState.focusGroup, 0);

    delete globalThis.shadow_get_ui_slot;
    uninstallMockFs();
    uninstallMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState();
}

/* ── every retarget survives the next status poll ────────────────────────── */
{
    _log('\nthe watched track — a retarget the engine was not told is undone:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetSession } = await import('../../dist/esm/seq/session.js');
    const { selectTrack } = await import('../../dist/esm/track/focus.js');
    const { beginTrackSwitch, switchToTrack } = await import('../../dist/esm/track/switch.js');

    const engine = installMockEngine();
    const reset = () => {
        engine.reset(); resetSeqEngine(); resetSeqState(); resetSession(); seqEngineTick();
    };
    /* Two ticks: the first flushes the queued command, the second polls the
     * engine's own answer back over the mirror. */
    const settle = () => { seqEngineTick(); seqEngineTick(); };

    /* Track button (focused group 2 → its second button is track 9). */
    reset();
    selectTrack(8);
    seqHandleMidi([0xB0, 42, 127], false);
    settle();
    eq('a track button retarget survives the poll', seqState.watchTrack, 9);

    /* Session grid: launching a clip moves the step view onto its track. */
    reset();
    seqState.sessionMode = true;
    selectTrack(9);                            // group 2 → tracks 8-11
    seqHandleMidi([0x90, 92, 127], false);     // top-left pad → track 8
    settle();
    eq('a session-grid launch survives the poll', seqState.watchTrack, 8);

    /* Track switch (the Session step-row selector's committed switch). */
    reset();
    switchToTrack(13, beginTrackSwitch());
    settle();
    eq('a committed track switch survives the poll', seqState.watchTrack, 13);

    seqState.sessionMode = false;
    selectTrack(0);
    uninstallMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); resetSession();
}

}
