/* browser-test/logic/track-watch.mjs — which track the sequencer edits
 *
 * There is one track: the selected one. The screen, pads and knobs read it
 * directly; the engine is told by comparison, once per tick, so that what the
 * step row edits and what the instrument plays cannot come apart. They did
 * once — movy opened on the track Move had selected but left the sequencer on
 * track 1, so a step-recorded take on track 2 was written into track 1's clip.
 *
 * Every case here polls the engine after the gesture instead of reading the
 * mirror straight back: `trk=` is the engine's answer, and a retarget that it
 * never heard is not a retarget.
 *
 * Run by browser-test/logic.mjs.
 */

import { env, eq, _log, lastMusicalOp, selectTrack, watchedTrack } from './harness.mjs';

export async function run() {

/* ── opening movy: the sequencer starts on track 1, and so does the engine ── */
{
    _log('\nthe watched track — movy opens on track 1:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { installMockFs, uninstallMockFs } = await import('../mock-fs.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    const { init } = await import('../../dist/esm/app/init.js');

    const engine = installMockEngine();
    installMockFs();
    const open = () => {
        engine.reset(); resetSeqEngine(); resetSeqState();
        init();
        seqEngineTick();   // probe → ready
        seqEngineTick();   // reconcile + flush, then poll the answer back
    };

    selectTrack(5);    // whatever the previous open left selected
    open();
    eq('the knobs and pads are on track 1', appState.activeTrack.index, 0);
    eq('and so is the step row', watchedTrack(), 0);
    eq('the engine agrees', engine.status.trk, 0);

    /* The whole point: a step recorded at once belongs to the module you can
     * hear. Asserted on the op the engine receives, because that — not the
     * mirror — decides which clip the note lands in. */
    seqNotePadPlayed(0, 80, 72, 110);
    seqHandleMidi([0x90, 16, 127], false);
    seqHandleMidi([0x80, 16, 0], false);
    seqEngineTick();
    eq('a step recorded at once goes into track 1\'s clip',
        lastMusicalOp(engine.ops), 'tog 0 0 72 110');

    /* The engine outlives the tool: closing movy leaves the DSP loaded, still
     * watching the track it was told last. Reopening on track 1 must take it
     * back, even though nothing in the fresh UI disagrees with track 0. */
    engine.status.trk = 2;              // as a previous session left it
    open();
    eq('reopening on track 1 takes the engine off the old track', engine.status.trk, 0);

    /* plans/2026-09-12-test-device-migration-followups.md item 5: a `watch`
     * sent while a Set is restoring can be lost to the single-slot
     * `overtake_dsp` SHM's observer effect (docs/persistence-hazards.md #1) —
     * overwritten before the engine core ever applies it, not merely delayed.
     * `dropWatchCount` models a few such losses in a row (roughly the width of
     * a slow restore). The reconciliation must keep retrying once the
     * contention clears, not settle for a push it only believes landed. */
    engine.status.trk = 2;
    engine.dropWatchCount = 3;
    open();
    for (let i = 0; i < 40; i++) seqEngineTick();
    eq('a watch lost to SHM contention during a restore is retried until it lands',
        engine.status.trk, 0);

    /* The focus group follows the track — the four track buttons address the
     * focused quartet, so a group left behind aims them at other tracks. */
    selectTrack(9);
    open();
    eq('the track buttons address the group the open landed in',
       appState.focusGroup, 0);

    uninstallMockFs();
    uninstallMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); selectTrack(0);
}

/* ── the engine is told by comparison, so no gesture can forget ──────────── */
{
    _log('\nthe watched track — the engine is reconciled, not notified:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetSession } = await import('../../dist/esm/seq/session.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    const { resetWatchPush } = await import('../../dist/esm/seq/watch.js');
    const { beginTrackSwitch, switchToTrack } = await import('../../dist/esm/track/switch.js');

    const engine = installMockEngine();
    const reset = () => {
        engine.reset(); resetSeqEngine(); resetSeqState(); resetSession(); resetWatchPush();
        selectTrack(0); seqEngineTick();
    };
    /* Long enough to cover a status poll (one every STATUS_POLL_TICKS), which
     * is the only way the engine's own answer gets back to the UI. */
    const settle = () => { for (let i = 0; i < 12; i++) seqEngineTick(); };

    /* A committed track switch — the track buttons and the Session step row. */
    reset();
    switchToTrack(13, beginTrackSwitch());
    settle();
    eq('a track switch reaches the engine', engine.status.trk, 13);

    /* Launching a clip from the Session grid selects its track outright: the
     * clip you launched is the one you are working on, so the instrument comes
     * with it. Moving only the step row left the knobs on another track — the
     * same split, reached from Session view. */
    reset();
    seqState.sessionMode = true;
    selectTrack(9);                            // group 2 → tracks 8-11
    seqHandleMidi([0x90, 92, 127], false);     // top-left pad → track 8
    settle();
    eq('a grid launch selects the clip\'s track', appState.activeTrack.index, 8);
    eq('and the engine follows it', engine.status.trk, 8);
    seqState.sessionMode = false;

    /* A command the engine never applied. The status is the acknowledgement,
     * so a disagreement — not a gesture — is what makes the UI say it again. */
    reset();
    selectTrack(5);
    settle();
    eq('the engine has the selected track', engine.status.trk, 5);
    engine.status.trk = 0;                     // as if the command were lost
    settle();
    eq('a disagreement re-sends it', engine.status.trk, 5);

    /* (An engine replaced under us — a re-dlopen — had to be re-taught the
     * track. movy-host never reloads the engine since WP10, so that case is
     * gone; the boot path still resets the watch push for the first engine.) */

    seqState.watchLane = -1;
    selectTrack(0);
    uninstallMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); resetSession();
}

}
