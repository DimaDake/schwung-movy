/* browser-test/logic/session-shift.mjs — the modifier split in Session view.
 *
 * Three meanings share the step row there, and they must not collide:
 *   - unmodified  → the 16-track selector
 *   - Loop held   → the scene launcher / song builder (song.ts)
 *   - Shift held  → the GLOBAL shifted step functions, exactly as in Track view
 *
 * Scene launching originally took Shift, which swallowed every shifted step
 * function in the one view where the CPU meter and Settings are most worth
 * reaching. This suite is the guard on the split: each shortcut is asserted to
 * do its own job in Session view AND not to switch tracks on the way (the
 * selector sits underneath every one of these steps).
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, lastMusicalOp, seqEngineTick, selectTrack, appState, _log } from './harness.mjs';

export async function run() {
    _log('\nsession view — shift vs loop:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { installMockFs, uninstallMockFs } = await import('../mock-fs.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { resetSong } = await import('../../dist/esm/seq/song.js');
    const { resetLoopMode } = await import('../../dist/esm/seq/loop-mode.js');
    const { resetParamPage } = await import('../../dist/esm/seq/param-page.js');
    const { resetTrackSelect } = await import('../../dist/esm/seq/track-select.js');
    const { resetSession } = await import('../../dist/esm/seq/session.js');
    const { VIEW_CHAIN, VIEW_MAIN_PARAMS, VIEW_CLIP_PARAMS, VIEW_FLAGS, VIEW_CPU } =
        await import('../../dist/esm/app/state.js');

    const engine = installMockEngine();
    installMockFs();
    const lastOp = () => lastMusicalOp(engine.ops);

    /* Back to a latched Session view on track 1, no page open, no modifier
     * left down — every case below starts from exactly the same place. */
    const reset = () => {
        engine.reset(); resetSeqEngine(); resetSeqState(); resetSession();
        resetSong(); resetLoopMode(); resetParamPage(); resetTrackSelect();
        selectTrack(0);
        appState.currentView = VIEW_CHAIN;
        seqState.sessionMode = true;
        seqEngineTick();
    };
    /* A whole press+release, so a shortcut that leaks into the selector shows
     * up as a track switch (the switch commits on the step's RELEASE). */
    const step = (idx, shift) => {
        seqHandleMidi([0x90, 16 + idx, 127], shift);
        seqHandleMidi([0x80, 16 + idx, 0], shift);
    };
    const loop = (down) => seqHandleMidi([0xB0, 58, down ? 127 : 0], false);

    /* ── the page openers ────────────────────────────────────────────────── */
    /* Step 12 is the sharpest of these: unshifted it is track 12, so a press
     * that fell through to the selector would move the whole UI. */
    const PAGES = [
        ['Settings', 1, VIEW_FLAGS],
        ['Set params', 4, VIEW_MAIN_PARAMS],
        ['Set params', 6, VIEW_MAIN_PARAMS],
        ['Set params', 8, VIEW_MAIN_PARAMS],
        ['the CPU meter', 11, VIEW_CPU],
    ];
    for (const [page, idx, view] of PAGES) {
        const combo = `Shift+Step ${idx + 1}`;
        reset();
        step(idx, true);
        eq(`${combo} opens ${page} in Session view`, appState.currentView, view);
        eq(`${combo} does not switch tracks`, appState.activeTrack.index, 0);
    }

    /* Clip Params is the one shortcut that is deliberately Track-view only:
     * Session view shows the clip grid, not a single clip. The Track-view arm
     * is the control — without it "did not open" would also pass for a press
     * that never arrived. */
    reset();
    step(2, true);
    eq('Shift+Step 3 does not open Clip params in Session view',
       appState.currentView, VIEW_CHAIN);
    reset(); seqState.sessionMode = false;
    step(2, true);
    eq('and the same press does open it in Track view',
       appState.currentView, VIEW_CLIP_PARAMS);

    /* ── the toggles and the clip edits ──────────────────────────────────── */
    reset();
    step(5, true); seqEngineTick();
    eq('Shift+Step 6 toggles the metronome in Session view', lastOp(), 'metro 1');
    eq('and does not switch tracks', appState.activeTrack.index, 0);

    reset();
    step(9, true);
    eq('Shift+Step 10 toggles full velocity in Session view', seqState.fullVelocity, true);
    eq('and does not switch tracks', appState.activeTrack.index, 0);

    reset();
    step(14, true); seqEngineTick();
    eq('Shift+Step 15 doubles the loop in Session view', lastOp(), 'dbl 0');

    reset();
    step(15, true); seqEngineTick();
    ok('Shift+Step 16 cycles the clip quantization in Session view',
       String(lastOp()).startsWith('cq 0 '));

    /* A shifted press on a step with no shortcut does nothing at all — and
     * above all does not build a song, which is what it used to do. */
    reset();
    step(0, true); seqEngineTick();
    ok('Shift+Step 1 no longer touches the song', !String(lastOp()).startsWith('song'));
    eq('and does not switch tracks either', appState.activeTrack.index, 0);

    /* ── what the other two modifiers still do ───────────────────────────── */
    reset();
    step(2, false);
    eq('an unmodified step is still the track selector', appState.activeTrack.index, 2);

    reset();
    loop(true);
    step(0, false); seqEngineTick();
    eq('Loop+step launches the scene', lastOp(), 'song 0');
    eq('and does not switch tracks', appState.activeTrack.index, 0);
    loop(false);
    eq('Loop stays a pure modifier in Session view', seqState.loopMode, false);

    /* The same button keeps its own meaning in Track view. */
    reset(); seqState.sessionMode = false;
    loop(true); loop(false);
    eq('a Loop tap in Track view still latches Loop Mode', seqState.loopMode, true);
    resetLoopMode(); seqState.loopMode = false;

    /* While the Session BUTTON is held the row is a transient selector inside
     * Track view, and the press is finishing that gesture — Shift does not
     * turn it into a shortcut. */
    reset();
    seqState.sessionMode = false;
    seqState.trackSelectHold = true;
    step(3, true);
    eq('Shift+step under a held Session button still selects the track',
       appState.activeTrack.index, 3);
    eq('and opens no page', appState.currentView, VIEW_CHAIN);

    /* ── the row's LEDs follow the same rule ─────────────────────────────── */
    {
        const { seqLedsTick, seqLedsInvalidate } = await import('../../dist/esm/seq/leds.js');
        const { C_GREEN, C_BLACK, trackColor } = await import('../../dist/esm/seq/colors.js');
        const msgs = [];
        const origSend = globalThis.move_midi_internal_send;
        globalThis.move_midi_internal_send = (m) => msgs.push(m);
        const lastColor = (note) => msgs.filter((m) => m[2] === note).at(-1)[3];

        /* Two frames: cachedSetAnimLED establishes a base before it animates. */
        reset(); seqLedsInvalidate();
        loop(true);
        msgs.length = 0;
        seqLedsTick(); seqLedsTick();
        eq('Loop held paints step 1 as scene 1', lastColor(16), C_GREEN);
        eq('and the step between scenes is inert', lastColor(17), C_BLACK);
        loop(false);

        reset(); seqLedsInvalidate();
        msgs.length = 0;
        seqLedsTick(true); seqLedsTick(true);   // Shift held
        eq('Shift leaves the row as the track selector', lastColor(17), trackColor(1));

        globalThis.move_midi_internal_send = origSend;
        seqLedsInvalidate();
    }

    reset();
    uninstallMockFs();
    uninstallMockEngine();
}
