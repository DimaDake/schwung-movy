/* browser-test/logic/seq-router.mjs — sequencer router + step-row LEDs + chromatic pads
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    keyboardState, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine, eq,
    lastMusicalOp, _log,
} from './harness.mjs';

export async function run() {
/* ── seq router: step toggle, chords, drum lanes, bars, Play, watch ──────── */
{
    _log('\nseq router:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, seqSetLane, setMuteHeld } =
        await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep, occToggleStep } = await import('../../dist/esm/seq/state.js');
    const { resetSeqToast, seqToastActive } = await import('../../dist/esm/seq/render.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetSeqToast();
    seqEngineTick(); // boot probe → ready
    const lastOp = () => lastMusicalOp(engine.ops);
    /* A tap = press then release; the note toggle fires on release. */
    const tapStep = (button) => {
        seqHandleMidi([0x90, 16 + button, 127], false);
        seqHandleMidi([0x80, 16 + button, 0], false);
    };

    eq('pad note not claimed', seqHandleMidi([0x90, 68, 100], false), false);
    eq('knob CC not claimed', seqHandleMidi([0xB0, 71, 65], false), false);

    // Pad play (padNote 80 → midiNote 72) sets the step-entry pitch + holds it.
    seqNotePadPlayed(0, 80, 72, 110);
    eq('pad play recorded as step-entry pitch', seqState.lastPitch[0], 72);

    // Tap step while a pad is held → places that note; toggles on release.
    eq('step note claimed', seqHandleMidi([0x90, 16, 127], false), true);
    seqHandleMidi([0x80, 16, 0], false);
    eq('optimistic occ set', occHasStep(0), true);
    eq('optimistic clip created (1 bar)', seqState.lenSteps, 16);
    eq('step entry does not auto-start', seqState.playing, false);
    seqEngineTick();
    eq('tog cmd emitted', lastOp(), 'tog 0 0 72 110');

    // Two held pads → chord placed in one tog op.
    seqState.playing = false;
    seqNotePadPlayed(0, 81, 74, 100);   // held: 72 and 74
    tapStep(5);                          // step 5
    seqEngineTick();
    eq('chord tog emits both pitches', lastOp(), 'tog 0 5 72 100 74 100');

    // Releasing pads → next step uses the last-played note only.
    seqNotePadReleased(80); seqNotePadReleased(81);
    seqNotePadPlayed(0, 80, 67, 90);
    seqNotePadReleased(80);              // pad released before the step tap
    tapStep(1);                          // step 1
    seqEngineTick();
    eq('after release, single note placed', lastOp(), 'tog 0 1 67 90');

    // Drum-lane mode: seqSetLane(38) → wlane, and a step tap uses ltog.
    seqSetLane(38);
    seqEngineTick();
    eq('wlane cmd emitted', lastOp(), 'wlane 38');
    tapStep(0);
    seqEngineTick();
    eq('drum lane uses ltog', lastOp(), 'ltog 0 0 38 90');
    seqSetLane(-1);
    seqEngineTick();
    eq('melodic lane -1', lastOp(), 'wlane -1');

    // ── Multi-step entry ──────────────────────────────────────────────────
    // Melodic: hold step A + press step B is the length gesture (set A's note
    // length to span A→B), so B is NOT entered as a step.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    occToggleStep(0);                            // step 0 occupied → length anchor
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold occupied step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 → length gesture
    seqHandleMidi([0x80, 16 + 3, 0], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    seqEngineTick();
    eq('melodic hold+press: B not entered', occHasStep(3), false);
    eq('melodic hold+press: emits slen', engine.ops.some((o) => o.startsWith('slen')), true);

    // Drum lane: hold step 0 + press step 3 enters BOTH (no length gesture) —
    // multiple steps can be entered while one is held.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    seqSetLane(38); seqEngineTick();
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 while step 0 held
    seqHandleMidi([0x80, 16 + 3, 0], false);     // release → step 3 toggles on
    seqHandleMidi([0x80, 16 + 0, 0], false);     // release → step 0 toggles on
    eq('drum multi: step 0 entered', occHasStep(0), true);
    eq('drum multi: step 3 entered', occHasStep(3), true);
    eq('drum multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);

    // Drum multi-step where the anchor is held past the 300ms step-automation
    // threshold (reproduces the device failure): after step 3 is released,
    // step 0 is held alone, and the per-tick stepAutoTick must NOT promote it to
    // step-automation mode (which would suppress its toggle). The anchor must
    // still enter on release.
    {
        const { stepAutoTick } = await import('../../dist/esm/seq/step-edit.js');
        resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
        seqState.lenSteps = 16;
        seqSetLane(38); seqEngineTick();
        const realNow = Date.now;
        let clock = 1000;
        Date.now = () => clock;
        seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0 (press at t=1000)
        seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 while step 0 held
        seqHandleMidi([0x80, 16 + 3, 0], false);     // release step 3 → toggles on
        clock = 1500;                                // 500ms later — past the 300ms threshold
        stepAutoTick();                              // per-tick promotion check fires here
        seqHandleMidi([0x80, 16 + 0, 0], false);     // release step 0 → must still toggle
        Date.now = realNow;
        eq('drum multi (>300ms hold): anchor still entered', occHasStep(0), true);
        eq('drum multi (>300ms hold): B still entered', occHasStep(3), true);
    }

    // Harder ordering (matches device MIDI-inject latency): the anchor is held
    // ALONE past 300ms and promoted to step-automation FIRST, then the second
    // step is pressed. The multi-press must cancel the anchor's promotion so it
    // still enters on release.
    {
        const { stepAutoTick } = await import('../../dist/esm/seq/step-edit.js');
        resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
        seqState.lenSteps = 16;
        seqSetLane(38); seqEngineTick();
        const realNow = Date.now;
        let clock = 1000;
        Date.now = () => clock;
        seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
        clock = 1400;                                // 400ms alone → promotes to auto mode
        stepAutoTick();
        seqHandleMidi([0x90, 16 + 3, 127], false);   // NOW press step 3 (multi-press)
        seqHandleMidi([0x80, 16 + 3, 0], false);     // release step 3
        seqHandleMidi([0x80, 16 + 0, 0], false);     // release step 0
        Date.now = realNow;
        eq('drum multi (anchor promoted first): anchor still entered', occHasStep(0), true);
        eq('drum multi (anchor promoted first): B entered', occHasStep(3), true);
    }
    seqSetLane(-1); seqEngineTick();

    // Mute held: a track-button press must NOT retarget the watched track.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.watchTrack = 0;
    setMuteHeld(true);
    seqHandleMidi([0xB0, 42, 127], false);   // track button for track 1 (CC 43 = track 0)
    eq('mute+track keeps watchTrack', seqState.watchTrack, 0);
    eq('mute+track emits no watch cmd', engine.ops.some((o) => o.startsWith('watch ')), false);
    setMuteHeld(false);

    // Copy held + two step presses (note view) → cpy then pst, no note toggled.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    {
        const { copyButton } = await import('../../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 16 + 2, 127], false); // source step 2
        seqHandleMidi([0x90, 16 + 9, 127], false); // dest step 9
        copyButton(false);
        seqEngineTick();                           // flush queued cmds to the mock engine
        eq('dup step copy via router', engine.ops.includes('cpy 0 2 2'), true);
        eq('dup step paste via router', engine.ops.includes('pst 0 9'), true);
        eq('dup step did not toggle a note', engine.ops.some((o) => o.startsWith('tog ')), false);
    }

    // Session: Copy held + two clip pads → clipcopy then clippaste, no launch.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.sessionMode = true;
    {
        const { copyButton } = await import('../../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 68, 127], false);     // pad 68 = track 3 slot 0 (bottom-left)
        seqHandleMidi([0x90, 68 + 1, 127], false); // dest pad
        copyButton(false);
        seqEngineTick();
        eq('dup clip copy via router', engine.ops.some((o) => o.startsWith('clipcopy')), true);
        eq('dup clip paste via router', engine.ops.some((o) => o.startsWith('clippaste')), true);
        eq('dup clip did not launch', engine.ops.some((o) => o.startsWith('launch')), false);
    }
    seqState.sessionMode = false;

    // Session: Clear held + clip pad → clipdelat + toast; multiple while held.
    resetSeqState(); engine.reset(); resetSeqEngine(); resetSeqToast(); seqEngineTick();
    seqState.sessionMode = true;
    seqHandleMidi([0xB0, 119, 127], false);   // hold Clear
    seqHandleMidi([0x90, 68, 127], false);     // clip A
    seqHandleMidi([0x90, 68 + 1, 127], false); // clip B (still held)
    seqEngineTick();
    eq('clear+clip deletes A', engine.ops.includes('clipdelat 3 0'), true);
    eq('clear+clip deletes B', engine.ops.includes('clipdelat 3 1'), true);
    seqHandleMidi([0xB0, 119, 0], false);
    seqState.sessionMode = false;

    // Step entry while stopped does not start the transport (UI mirror).
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.playing = false;
    seqHandleMidi([0x90, 16 + 0, 127], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    eq('step entry keeps playing false', seqState.playing, false);

    // Bar navigation: Right advances the visible bar (clip is 1 bar long, so
    // one extra empty bar is reachable), with a toast; clamps at the end.
    resetSeqState(); resetSeqToast();
    seqState.lenSteps = 16; // one bar
    eq('Right arrow claimed (engine ready)', seqHandleMidi([0xB0, 63, 127], false), true);
    eq('barOffset advanced to 1', seqState.barOffset, 1);
    // Bar-N toasts were dropped (Task 9); bar nav is now silent.
    seqHandleMidi([0xB0, 63, 127], false);     // clamp: max is 1 for a 1-bar clip
    eq('barOffset clamped', seqState.barOffset, 1);
    seqHandleMidi([0xB0, 62, 127], false);     // Left
    eq('Left arrow returns to bar 0', seqState.barOffset, 0);
    // Step tap on bar 1 targets absolute step 16.
    seqState.barOffset = 1;
    seqNotePadPlayed(0, 80, 60, 100); seqNotePadReleased(80);
    tapStep(0);
    seqEngineTick();
    eq('bar offset maps to absolute step', lastOp(), 'tog 0 16 60 100');

    // Play toggles transport based on the mirror.
    resetSeqState();
    eq('Play CC claimed', seqHandleMidi([0xB0, 85, 127], false), true);
    seqEngineTick();
    eq('play cmd emitted', lastOp(), 'play');
    eq('optimistic play mirror', seqState.playing, true);
    seqHandleMidi([0xB0, 85, 127], false);
    seqEngineTick();
    eq('second press emits stop', lastOp(), 'stop');

    // Track buttons: watch retarget without claiming the event.
    eq('track button NOT claimed', seqHandleMidi([0xB0, 41, 127], false), false);
    seqEngineTick();
    eq('watch cmd emitted for track 2', lastOp(), 'watch 2');
    eq('watchTrack mirrored', seqState.watchTrack, 2);

    // Arrows fall through to existing nav when the engine is NOT ready.
    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
    eq('Right arrow NOT claimed without engine', seqHandleMidi([0xB0, 63, 127], false), false);

    engine.reset(); resetSeqEngine(); resetSeqState(); resetSeqToast();
}

/* ── seq LEDs: track-colored step row, cached painting ───────────────────── */
{
    _log('\nseq LEDs:');
    const { seqLedsTick, seqLedsInvalidate } = await import('../../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../../dist/esm/seq/state.js');
    const { C_WHITE, C_DARKGREY, C_GREEN, C_BLACK, trackColorDim } =
        await import('../../dist/esm/seq/colors.js');

    const ledCalls = [];
    const origSetLED = globalThis.setLED;
    const origSetButtonLED = globalThis.setButtonLED;
    globalThis.setLED = (note, color) => ledCalls.push([note, color]);
    globalThis.setButtonLED = (cc, color) => ledCalls.push(['b' + cc, color]);

    resetSeqState(); seqLedsInvalidate();
    seqState.watchTrack = 0;
    seqState.lenSteps = 32;       // 2 bars
    occToggleStep(0); occToggleStep(4);
    seqState.playing = true;
    seqState.curStep = 2;

    // Cold frame paints progressively (FRAME_BUDGET sends/tick); drain it so
    // every LED (incl. the last-painted transport button) has been emitted.
    for (let i = 0; i < 3; i++) seqLedsTick();
    let byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('occupied step white', byNote[16], C_WHITE);
    eq('occupied step white (2)', byNote[20], C_WHITE);
    eq('playhead green', byNote[18], C_GREEN);
    eq('empty in-loop dim track color', byNote[17], trackColorDim(0));
    eq('play button lit (green)', byNote.b85, C_GREEN);

    // Cached layer: identical repaint sends nothing.
    ledCalls.length = 0;
    seqLedsTick();
    eq('no LED traffic when unchanged', ledCalls.length, 0);

    // Playhead movement repaints exactly the two affected steps.
    seqState.curStep = 3;
    seqLedsTick();
    eq('playhead move repaints 2 LEDs', ledCalls.length, 2);

    // Bar 2 view: bar 1 is in-loop (steps 16-31), so all dim track color;
    // a step past the loop would be dim gray, but len=32 fills bar 1.
    ledCalls.length = 0;
    seqState.barOffset = 1;
    seqState.playing = false;
    seqLedsInvalidate();
    seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('bar 2 in-loop dim track color', byNote[16], trackColorDim(0));

    // Steps past the clip length are not part of the pattern → fully off.
    ledCalls.length = 0;
    seqState.lenSteps = 16;       // shrink to 1 bar; bar 2 now beyond the clip
    seqLedsInvalidate();
    seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('step beyond clip length is off', byNote[16], C_BLACK);

    // Recording: playhead step is red instead of green.
    resetSeqState(); seqLedsInvalidate();
    const { C_REC_RED: C_REC_RED_LED } = await import('../../dist/esm/seq/colors.js');
    seqState.watchTrack = 0; seqState.lenSteps = 16; seqState.playing = true;
    seqState.recording = true; seqState.curStep = 0;
    ledCalls.length = 0;
    for (let i = 0; i < 3; i++) seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('playhead red when recording', byNote[16], C_REC_RED_LED);

    // Session mode: the step row is the 16-track selector, NOT steps. Step
    // occupancy is set here precisely to prove it is ignored — the row shows
    // track colours regardless of what the watched clip contains.
    resetSeqState(); seqLedsInvalidate();
    seqState.sessionMode = true;
    seqState.lenSteps = 16; occToggleStep(0); occToggleStep(4);
    /* The step row's colours in Session mode are pinned by the sessionStepLed
     * unit assertions further down — deterministic, and independent of the LED
     * cache's frame budget. What is checked HERE is only that Session mode does
     * not fall through to the normal step painter: occupancy is set on steps 0
     * and 4 above, and neither may show the occupied-white. */
    seqLedsInvalidate();
    ledCalls.length = 0;
    for (let i = 0; i < 8; i++) seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('session step row ignores clip occupancy', byNote[16] === 120, false);
    eq('session step row ignores occupancy on step 4', byNote[20] === 120, false);

    globalThis.setLED = origSetLED;
    globalThis.setButtonLED = origSetButtonLED;
    resetSeqState(); seqLedsInvalidate();
}

/* ── seq pads: chromatic layout + coloring ───────────────────────────────── */
{
    _log('\nseq chromatic pads:');
    const { padPitch, padColor } = await import('../../dist/esm/seq/pads.js');
    const { trackColor } = await import('../../dist/esm/seq/colors.js');
    const { keyboardState, resetPadMapCache } = await import('../../dist/esm/keyboard/state.js');

    const PAD_MIN = 68;
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];   // base 48 = C3
    resetPadMapCache();

    // The root sits on column 4, so bottom-left is base-3; +1 per column right,
    // +5 per row up.
    eq('bottom-left = base - 3', padPitch(0, 68, PAD_MIN), 45);
    eq('root at column 4 = base', padPitch(0, 71, PAD_MIN), 48);
    eq('one column right = +1 semitone', padPitch(0, 72, PAD_MIN), 49);
    eq('one row up = +5 semitones', padPitch(0, 79, PAD_MIN), 53);
    eq('top row (row 3) = +15', padPitch(0, 95, PAD_MIN), 63);

    // Coloring: root C = track color, in-scale gray, out-of-scale dark.
    eq('root C uses track color', padColor(71, PAD_MIN, 2, false), trackColor(2));
    // base+2 = D (in C major) → light gray (118)
    eq('in-scale note light gray', padColor(73, PAD_MIN, 0, false), 118);
    // base+1 = C# (out of scale) → dark
    eq('out-of-scale dark', padColor(72, PAD_MIN, 0, false), 0);
    // isPlaying=true → green (sounding, highest priority)
    eq('playing pad green', padColor(72, PAD_MIN, 0, true), 11);
}

}
