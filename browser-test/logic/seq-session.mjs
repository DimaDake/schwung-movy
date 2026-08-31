/* browser-test/logic/seq-session.mjs — recording, Session mode, its LEDs and grid focus, the loop overview strip
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    selectTrack, watchedTrack,
    ENGINE_VERSION, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine, appState,
    eq, lastMusicalOp, _log,
} from './harness.mjs';

export async function run() {
/* ── seq recording: Rec, metronome, quantize, live capture ───────────────── */
{
    _log('\nseq recording:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetEditOps } = await import('../../dist/esm/seq/edit-ops.js');
    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { resetSeqToast } = await import('../../dist/esm/seq/render.js');

    const { resetStepRec } = await import('../../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetEditOps(); resetStepEdit();
        resetStepRec(); resetSeqToast(); engine.reset();
    };
    const lastOp = () => lastMusicalOp(engine.ops);
    reset(); seqEngineTick();

    // A Rec TAP → rec command on the watched track. (Holding Rec while stopped
    // is step recording instead; the tap keeps the live-record arm.)
    seqHandleMidi([0xB0, 86, 127], false);
    seqHandleMidi([0xB0, 86, 0], false);
    seqEngineTick();
    eq('Rec emits rec command', lastOp(), 'rec 0');

    // Shift+Step 6 toggles metronome; Shift+Step 16 quantizes.
    seqHandleMidi([0x90, 16 + 5, 127], true);
    seqEngineTick();
    eq('Shift+Step6 toggles metronome', lastOp(), 'metro 1');
    seqHandleMidi([0x90, 16 + 15, 127], true);
    seqEngineTick();
    eq('Shift+Step16 cycles quantization', lastOp(), 'cq 0 100');

    // Live pad notes forward non/nof for recording capture.
    reset(); seqEngineTick();
    seqNotePadPlayed(0, 80, 67, 110);
    seqEngineTick();
    eq('pad-on forwards non', lastOp(), 'non 0 67 110');
    seqNotePadReleased(80, 0);
    seqEngineTick();
    eq('pad-off forwards nof', lastOp(), 'nof 0 67');

    // The capture-off follows the track the note was played on, not whatever the
    // UI is watching now — a track switch mid-hold used to misroute it.
    reset(); seqEngineTick();
    seqNotePadPlayed(0, 80, 67, 110);
    seqEngineTick();
    seqNotePadReleased(80, 2);
    seqEngineTick();
    eq('pad-off nof uses the owner track', lastOp(), 'nof 2 67');

    // Status mirrors recording flags for the Rec LED.
    engine.status.rec = 1; engine.status.cin = 0; engine.status.metro = 1;
    globalThis.host_module_get_param = (key) =>
        key === 'status' ? 'play=1 rec=1 cin=0 metro=1' : (key === 'ping' ? 'pong ' + ENGINE_VERSION : null);
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('recording flag mirrored', seqState.recording, true);
    eq('metronome flag mirrored', seqState.metro, true);

    uninstallMockEngine(); reset();
}

/* ── seq session mode: grid, launch/stop, copy/delete clips ──────────────── */
{
    _log('\nseq session mode:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, sessionFromStr } = await import('../../dist/esm/seq/state.js');
    const { resetSession } = await import('../../dist/esm/seq/session.js');
    const { resetSeqToast } = await import('../../dist/esm/seq/render.js');
    const { resetDuplicate } = await import('../../dist/esm/seq/duplicate.js');

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetSession(); resetDuplicate(); resetSeqToast(); engine.reset(); };
    const lastOp = () => lastMusicalOp(engine.ops);
    reset(); seqEngineTick();

    // Note/Session toggle.
    seqHandleMidi([0xB0, 50, 127], false);
    eq('Note/Session enters session', seqState.sessionMode, true);

    // Pad grid mapping: top-left pad (note 92) = track 0, slot 0.
    seqHandleMidi([0x90, 92, 127], false);
    seqEngineTick();
    eq('top-left pad → launch track 0 slot 0', lastOp(), 'launch 0 0');
    eq('launch retargets watch track', watchedTrack(), 0);
    // Bottom-left pad (note 68) = track 3, slot 0.
    seqHandleMidi([0x90, 68, 127], false);
    seqEngineTick();
    eq('bottom-left pad → track 3 slot 0', lastOp(), 'launch 3 0');
    // One column right on the top row (note 93) = track 0, slot 1.
    seqHandleMidi([0x90, 93, 127], false);
    seqEngineTick();
    eq('column maps to slot', lastOp(), 'launch 0 1');

    // Pads are claimed in session mode (not played as notes).
    eq('session pad note-on claimed', seqHandleMidi([0x90, 80, 100], false), true);
    eq('session pad note-off claimed', seqHandleMidi([0x80, 80, 0], false), true);

    // Delete + pad → delete that clip.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    seqHandleMidi([0xB0, 119, 127], false);   // Delete down
    seqHandleMidi([0x90, 92, 127], false);    // track 0 slot 0
    seqEngineTick();
    eq('Delete+pad clears the clip', lastOp(), 'clipdelat 0 0');
    seqHandleMidi([0xB0, 119, 0], false);

    // Copy HELD → src pad → dest pad (still held) → clip copy then paste.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    seqHandleMidi([0xB0, 60, 127], false);    // Copy down (held)
    seqHandleMidi([0x90, 92, 127], false);    // src = track 0 slot 0
    seqEngineTick();
    eq('clip copy op', lastOp(), 'clipcopy 0 0');
    seqHandleMidi([0x90, 93, 127], false);    // dest = track 0 slot 1 (still held)
    seqEngineTick();
    eq('clip paste op', lastOp(), 'clippaste 0 1');
    seqHandleMidi([0xB0, 60, 0], false);      // Copy up

    // Status `sess=` populates the grid mirror.
    sessionFromStr('03.0.-.0,00.-.-.0,00.-.-.0,00.-.-.0');
    eq('session exist bitmap parsed', seqState.session[0].exist, 0x03);
    eq('session playing slot parsed', seqState.session[0].playing, 0);
    eq('session no-queue parsed as -1', seqState.session[0].queued, -1);

    uninstallMockEngine(); reset();
}

/* ── seq session LEDs: clip grid colors ──────────────────────────────────── */
{
    _log('\nseq session LEDs:');
    const { sessionPaintGrid, resetSession } = await import('../../dist/esm/seq/session.js');
    const { seqState, resetSeqState, sessionFromStr } = await import('../../dist/esm/seq/state.js');
    const { C_WHITE, C_BLACK, C_DARKGREY, trackColor,
            ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../../dist/esm/seq/colors.js');

    resetSeqState(); resetSession();
    // track0: slot0 exists+playing; slot1 exists (stopped); slot2 queued;
    // slot3 exists+selected (focus). tracks 1-3: empty, selected=0.
    sessionFromStr('0F.0.2.3,00.-.-.0,00.-.-.0,00.-.-.0');

    const cells = {};
    sessionPaintGrid((note, base, anim, channel) => { cells[note] = { base, anim, channel }; }, 68);
    // top row = track 0: notes 92/93/94/95 = slots 0/1/2/3.
    eq('playing pulses (Pulse4th) to white', cells[92].channel, ANIM_PULSE);
    eq('playing anim target white', cells[92].anim, C_WHITE);
    eq('playing base = track color', cells[92].base, trackColor(0));
    eq('stopped clip is solid', cells[93].channel, ANIM_NONE);
    eq('stopped clip = track color', cells[93].base, trackColor(0));
    eq('queued pulses fast (Pulse8th)', cells[94].channel, ANIM_PULSE_FAST);
    eq('queued anim target white', cells[94].anim, C_WHITE);
    eq('selected clip pulses slow (Pulse2th)', cells[95].channel, ANIM_PULSE_SLOW);
    eq('selected clip base = track color', cells[95].base, trackColor(0));

    // Selection highlight is NOT gated on watchTrack: every track greys its own
    // selected (default slot 0) empty cell, solid (no animation).
    eq('track3 selected-empty grey', cells[68].base, C_DARKGREY); // bottom row slot 0
    eq('track3 selected-empty solid', cells[68].channel, ANIM_NONE);
    eq('track2 selected-empty grey', cells[76].base, C_DARKGREY);
    eq('track1 selected-empty grey', cells[84].base, C_DARKGREY);
    eq('track3 unselected-empty dark', cells[69].base, C_BLACK);   // slot 1, not selected
    eq('track3 unselected-empty solid', cells[69].channel, ANIM_NONE);

    /* The grid follows the FOCUSED GROUP, like the four track buttons beside it.
     * It used to derive the track from the pad row alone, so all four rows were
     * pinned to tracks 1-4 whatever the octave buttons had scrolled to: moving
     * the group repainted the step row and the track buttons and left the clip
     * grid showing the wrong quartet's clips entirely. */
    const { selectTrack } = await import('../../dist/esm/track/focus.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    resetSeqState(); resetSession();
    // Give every track a clip in slot 0 so each row's colour identifies its track.
    sessionFromStr(Array.from({ length: 16 }, () => '01.-.-.0').join(','));

    selectTrack(9);                       // focus group 2 → tracks 8-11
    eq('selecting track 9 focused group 2', appState.focusGroup, 2);
    const g2 = {};
    sessionPaintGrid((note, base, anim, channel) => { g2[note] = { base, anim, channel }; }, 68);
    eq('top row is the group\'s first track (8)',  g2[92].base, trackColor(8));
    eq('second row is track 9',                    g2[84].base, trackColor(9));
    eq('third row is track 10',                    g2[76].base, trackColor(10));
    eq('bottom row is the group\'s last track (11)', g2[68].base, trackColor(11));

    selectTrack(15);                      // focus group 3 → tracks 12-15
    const g3 = {};
    sessionPaintGrid((note, base, anim, channel) => { g3[note] = { base, anim, channel }; }, 68);
    eq('the last group\'s top row is track 12',  g3[92].base, trackColor(12));
    eq('the last group\'s bottom row is track 15', g3[68].base, trackColor(15));

    selectTrack(0);
    resetSeqState(); resetSession();
}

/* ── seq session grid INPUT follows the focused group ────────────────────── */
{
    _log('\nseq session grid input:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetSession } = await import('../../dist/esm/seq/session.js');
    const { resetDuplicate } = await import('../../dist/esm/seq/duplicate.js');
    const { resetSeqToast } = await import('../../dist/esm/seq/render.js');
    const { selectTrack } = await import('../../dist/esm/track/focus.js');

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetSession(); resetDuplicate(); resetSeqToast(); engine.reset(); };
    const lastOp = () => lastMusicalOp(engine.ops);

    /* Reading the grid wrong is cosmetic; PRESSING it wrong is not. Launch,
     * Delete and Copy all resolved the pad to tracks 0-3 regardless of the
     * focused group, so a Delete on the bottom row while looking at tracks
     * 13-16 destroyed track 4's clip instead. */
    reset(); seqEngineTick();
    seqState.sessionMode = true;
    selectTrack(9);                              // group 2 → tracks 8-11

    seqHandleMidi([0x90, 92, 127], false);       // top-left pad
    seqEngineTick();
    eq('top-left pad launches the group\'s first track', lastOp(), 'launch 8 0');
    eq('and retargets the watched track with it', watchedTrack(), 8);

    seqHandleMidi([0x90, 68, 127], false);       // bottom-left pad
    seqEngineTick();
    eq('bottom-left pad launches the group\'s last track', lastOp(), 'launch 11 0');

    seqHandleMidi([0x90, 69, 127], false);       // bottom row, one column right
    seqEngineTick();
    eq('columns are still slots', lastOp(), 'launch 11 1');

    // Delete + pad must reach the same track the pad displays.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    selectTrack(15);                             // group 3 → tracks 12-15
    seqHandleMidi([0xB0, 119, 127], false);      // Delete down
    seqHandleMidi([0x90, 68, 127], false);       // bottom-left = track 15
    seqEngineTick();
    eq('Delete+pad deletes the clip the pad shows', lastOp(), 'clipdelat 15 0');
    seqHandleMidi([0xB0, 119, 0], false);

    // Copy/paste too.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    selectTrack(4);                              // group 1 → tracks 4-7
    seqHandleMidi([0xB0, 60, 127], false);       // Copy down
    seqHandleMidi([0x90, 92, 127], false);       // src = track 4 slot 0
    seqEngineTick();
    eq('clip copy uses the focused group', lastOp(), 'clipcopy 4 0');
    seqHandleMidi([0x90, 93, 127], false);       // dest = track 4 slot 1
    seqEngineTick();
    eq('clip paste uses the focused group', lastOp(), 'clippaste 4 1');
    seqHandleMidi([0xB0, 60, 0], false);

    selectTrack(0);
    uninstallMockEngine(); reset();
}

/* ── seq LED animation channel constants ─────────────────────────────────── */
{
    _log('\nseq anim constants:');
    const { ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../../dist/esm/seq/colors.js');
    eq('NoAnimation channel', ANIM_NONE, 0x00);
    eq('Pulse4th channel', ANIM_PULSE, 0x09);
    eq('Pulse8th channel', ANIM_PULSE_FAST, 0x08);
    eq('Pulse2th channel', ANIM_PULSE_SLOW, 0x0A);
}

/* ── seq cachedSetAnimLED: native animation + base handshake ──────────────── */
{
    _log('\nseq anim LED cache:');
    const { cachedSetAnimLED, ledFrameReset, seqLedsInvalidate }
        = await import('../../dist/esm/seq/leds.js');
    const { ANIM_NONE, ANIM_PULSE } = await import('../../dist/esm/seq/colors.js');

    const sent = [];
    const savedSend = globalThis.move_midi_internal_send;
    globalThis.move_midi_internal_send = (arr) => { sent.push(arr.slice()); };
    const tick = (fn) => { ledFrameReset(); fn(); };

    seqLedsInvalidate();              // clear cache state

    // Solid color: one note-on on channel 0.
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('solid emits one msg', sent.length, 1);
    eq('solid status ch0', sent[0][1], 0x90);
    eq('solid note', sent[0][2], 70);
    eq('solid color', sent[0][3], 22);

    // Re-sending the same solid state sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('unchanged solid sends nothing', sent.length, 0);

    // Animate a note whose base is already established (base 22 == last solid):
    // emits exactly one message, on the Pulse channel, with the anim color.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('anim w/ established base = one msg', sent.length, 1);
    eq('anim status = 0x90 | channel', sent[0][1], 0x90 | ANIM_PULSE);
    eq('anim color is the target', sent[0][3], 120);

    // Re-sending the same animation sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('unchanged anim sends nothing', sent.length, 0);

    // Handshake: a note whose base differs from last sent emits the base (ch0)
    // this tick, then the animation on the NEXT tick.
    seqLedsInvalidate(); sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // base 7 never sent
    eq('handshake tick1 = base on ch0', sent.length, 1);
    eq('handshake tick1 status ch0', sent[0][1], 0x90);
    eq('handshake tick1 color = base', sent[0][3], 7);
    sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // same request next tick
    eq('handshake tick2 = anim', sent.length, 1);
    eq('handshake tick2 status = pulse', sent[0][1], 0x90 | ANIM_PULSE);
    eq('handshake tick2 color = anim', sent[0][3], 120);

    globalThis.move_midi_internal_send = savedSend;
    seqLedsInvalidate();
}

/* ── seq loop overview strip (bottom-of-screen render) ───────────────────── */
{
    _log('\nseq loop strip:');
    const rects = [];
    const origFill = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push({ x, y, w, h, v });

    const { drawLoopStrip } = await import('../../dist/esm/seq/render.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    // 2-bar clip, bar 0 selected, not playing.
    resetSeqState();
    seqState.lenSteps = 32;
    seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    // First rect clears the band; then a thick segment for the selected bar
    // and a thin one for the other.
    eq('strip clears its band first', rects[0].v, 0);
    const segs = rects.slice(1).filter(r => r.v === 1);
    eq('two bar segments drawn', segs.length, 2);
    eq('selected bar is thick (2px)', segs[0].h, 2);
    eq('other bar is thin (1px)', segs[1].h, 1);

    // Single-bar loop → the sole bar is thin (native rule).
    resetSeqState(); seqState.lenSteps = 16; seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    const seg1 = rects.slice(1).filter(r => r.v === 1);
    eq('single-bar loop draws one segment', seg1.length, 1);
    eq('single bar is thin', seg1[0].h, 1);

    // Navigating to the empty bar past a 1-bar loop draws a "+" (two rects).
    resetSeqState(); seqState.lenSteps = 16; seqState.barOffset = 1;
    rects.length = 0;
    drawLoopStrip();
    // bar 0 segment (1) + plus icon (2 rects) = 3 lit rects.
    eq('empty bar shows a plus marker', rects.slice(1).filter(r => r.v === 1).length, 3);

    // Playing adds a vertical playhead mark (4px tall).
    resetSeqState(); seqState.lenSteps = 32; seqState.playing = true; seqState.curStep = 4;
    rects.length = 0;
    drawLoopStrip();
    eq('playhead mark drawn while playing', rects.some(r => r.v === 1 && r.h === 4), true);

    // No clip in the current slot → the band is cleared but no line is drawn.
    resetSeqState(); seqState.lenSteps = 0; seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    eq('empty slot clears the band', rects[0].v, 0);
    eq('empty slot draws no line', rects.slice(1).filter(r => r.v === 1).length, 0);
    // Even mid-transport, an empty slot shows nothing (no clip = nothing to play).
    resetSeqState(); seqState.lenSteps = 0; seqState.playing = true;
    rects.length = 0;
    drawLoopStrip();
    eq('empty slot draws no playhead while playing', rects.slice(1).filter(r => r.v === 1).length, 0);

    // Loop = bars 3-4 (steps 32..63), viewing bar 3. Segments must land on the
    // ACTIVE bars; before the fix these drew at bars 0-1 and bar 2 became a "+".
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    rects.length = 0;
    drawLoopStrip();
    const mid = rects.slice(1).filter(r => r.v === 1);
    eq('mid-clip loop draws two segments', mid.length, 2);
    eq('selected loop bar is thick', mid[0].h, 2);
    eq('selected segment starts at x=1', mid[0].x, 1);
    eq('other loop bar is thin', mid[1].h, 1);

    // Viewing the empty bar past a mid-clip loop → 3 spans, the last a "+".
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 4;
    rects.length = 0;
    drawLoopStrip();
    // 2 loop segments + plus icon (2 rects) = 4 lit rects.
    eq('bar past a mid-clip loop shows a plus', rects.slice(1).filter(r => r.v === 1).length, 4);

    // Sweep stays inside the active window, never over the "+" bar.
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 4;
    seqState.playing = true; seqState.posTick = 32 * 24;   // first tick of the loop
    rects.length = 0;
    drawLoopStrip();
    const sweep = rects.slice(1).find(r => r.v === 1 && r.h === 4);
    eq('sweep drawn', sweep !== undefined, true);
    eq('sweep starts at the window origin', sweep.x, 0);

    globalThis.fill_rect = origFill;
    resetSeqState();
}

}
