/* browser-test/logic/step-record.mjs — step recording: entry, arrows, step buttons, header text, grow/wrap
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    installMockEngine, seqEngineTick, resetSeqEngine, eq, musicalOps, _log,
    env,
} from './harness.mjs';

export async function run() {
/* ── step recording: entry, chords, advance, grow/wrap ───────────────────── */
{
    _log('\nstep record — core:');
    const { installMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, seqSetLane } =
        await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../../dist/esm/seq/state.js');
    const {
        stepRecActive, stepRecHead, stepRecGrowMode, resetStepRec,
    } = await import('../../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    const boot = () => {
        engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); seqEngineTick();
    };
    /* Rec is CC 86. Time is stubbed so tap-vs-hold is deterministic. */
    const recDown = () => seqHandleMidi([0xB0, 86, 127], false);
    const recUp   = () => seqHandleMidi([0xB0, 86, 0], false);
    const padOn  = (pad, note, vel = 100) => seqNotePadPlayed(0, pad, note, vel);
    const padOff = (pad) => seqNotePadReleased(pad, 0);

    const realNow = Date.now;
    let t = 50000;
    Date.now = () => t;

    // ── entering the mode while stopped ───────────────────────────────────
    boot();
    seqState.playing = false;
    recDown();
    eq('Rec down while stopped enters step record', stepRecActive(), true);
    eq('head starts at step 1', stepRecHead(), 0);
    eq('empty clip → grow mode', stepRecGrowMode(), true);
    seqEngineTick();
    eq('no rec arm emitted on entry', engine.ops.includes('rec 0'), false);
    eq('head announced to the engine', engine.ops.includes('hold 0 0'), true);

    // ── a chord lands on one step, release advances ───────────────────────
    engine.ops.length = 0;
    padOn(80, 72, 100);
    padOn(81, 76, 100);
    seqEngineTick();
    eq('melodic first pad clears the step first', musicalOps(engine.ops)[0], 'del 0 0 0 -1');
    eq('melodic first pad writes', musicalOps(engine.ops)[1], 'addp 0 0 0 72 100');
    // By index for the first two (the delete must precede the write); by
    // content for the second pad, which a grow-mode `clen 0 1` now sits after.
    eq('second pad joins the same step', engine.ops.includes('addp 0 0 0 76 100'), true);
    eq('head has not moved while pads are down', stepRecHead(), 0);
    padOff(80);
    eq('head waits for the LAST pad', stepRecHead(), 0);
    padOff(81);
    eq('all pads up → head advances', stepRecHead(), 1);
    eq('grow mode set the clip to what was played', seqState.lenSteps, 1);
    seqEngineTick();
    eq('clen trims the engine bar-rounding', engine.ops.includes('clen 0 1'), true);
    eq('occupancy mirrored for the LED', occHasStep(0), true);

    // ── non-overlapping taps advance one step each ────────────────────────
    padOn(80, 72, 100); padOff(80);
    eq('second note advanced again', stepRecHead(), 2);
    padOn(80, 74, 100); padOff(80);
    eq('third note advanced again', stepRecHead(), 3);
    eq('clip grew per step, not per bar', seqState.lenSteps, 3);

    // ── melodic replace: re-entering a step wipes it first ────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;   // existing clip
    recDown();
    eq('non-empty clip → wrap mode', stepRecGrowMode(), false);
    seqEngineTick();                       // flush the entry `hold`
    engine.ops.length = 0;
    padOn(80, 72, 100); padOff(80);
    seqEngineTick();
    eq('melodic overwrite deletes then adds', musicalOps(engine.ops)[0], 'del 0 0 0 -1');
    eq('existing clip length untouched', seqState.lenSteps, 16);

    // ── drums add, never delete ───────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    seqSetLane(38);                       // drum lane → watchLane >= 0
    recDown();
    engine.ops.length = 0;
    padOn(80, 36, 120); padOff(80);
    seqEngineTick();
    eq('drum pad never deletes the step', engine.ops.some((o) => o.startsWith('del')), false);
    eq('drum pad adds its own lane', engine.ops.includes('addp 0 0 0 36 120'), true);
    seqSetLane(-1);

    // ── wrap at the clip end ──────────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 4; seqState.loopStart = 0;
    recDown();
    for (let i = 0; i < 3; i++) { padOn(80, 72, 100); padOff(80); }
    eq('head at the last step', stepRecHead(), 3);
    padOn(80, 72, 100); padOff(80);
    eq('past the end wraps to the loop start', stepRecHead(), 0);
    eq('wrap mode never grows the clip', seqState.lenSteps, 4);

    // ── exit: tap falls through to arm, hold does not ─────────────────────
    boot();
    seqState.playing = false;
    recDown();
    t += 100;                              // quick tap, nothing entered
    recUp();
    seqEngineTick();
    eq('empty tap still arms live record', engine.ops.includes('rec 0'), true);
    eq('mode left', stepRecActive(), false);

    boot();
    seqState.playing = false;
    recDown();
    t += 100;
    padOn(80, 72, 100); padOff(80);        // something happened
    recUp();
    seqEngineTick();
    eq('a tap that entered notes does not also arm', engine.ops.includes('rec 0'), false);

    boot();
    seqState.playing = false;
    recDown();
    t += 900;                              // a long hold, nothing entered
    recUp();
    seqEngineTick();
    eq('a long hold does not arm', engine.ops.includes('rec 0'), false);
    eq('exit releases the engine hold', engine.ops.includes('hold 0 -1'), true);

    // ── while playing, Rec is unchanged ───────────────────────────────────
    boot();
    seqState.playing = true;
    recDown();
    eq('Rec while playing does not enter step record', stepRecActive(), false);
    seqEngineTick();
    eq('Rec while playing arms immediately', engine.ops.includes('rec 0'), true);
    recUp();
    seqEngineTick();
    eq('the release does not arm a second time',
        engine.ops.filter((o) => o === 'rec 0').length, 1);

    Date.now = realNow;
    seqState.playing = false;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}

/* ── step recording: arrows (rest, back-step, tie) ───────────────────────── */
{
    _log('\nstep record — arrows:');
    const { installMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { stepRecHead, stepRecPreviewPending, resetStepRec } =
        await import('../../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    const boot = () => {
        engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); seqEngineTick();
    };
    const recDown = () => seqHandleMidi([0xB0, 86, 127], false);
    const right   = () => seqHandleMidi([0xB0, 63, 127], false);
    const left    = () => seqHandleMidi([0xB0, 62, 127], false);
    const padOn   = (pad, note, vel = 100) => seqNotePadPlayed(0, pad, note, vel);
    const padOff  = (pad) => seqNotePadReleased(pad, 0);

    const realNow = Date.now;
    let t = 60000;
    Date.now = () => t;

    // ── rest: → with no pad held leaves the step empty ────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    eq('right arrow claimed while step recording', seqHandleMidi([0xB0, 63, 127], false), true);
    eq('rest advanced the head', stepRecHead(), 1);
    engine.ops.length = 0;
    padOn(80, 72, 100); padOff(80);
    seqEngineTick();
    eq('the note landed after the rest', engine.ops.includes('addp 0 1 1 72 100'), true);

    // ── back-step ─────────────────────────────────────────────────────────
    eq('head moved on', stepRecHead(), 2);
    left();
    eq('left arrow steps back', stepRecHead(), 1);
    eq('back-step asks for a preview', stepRecPreviewPending(), true);
    left();
    left();
    eq('left arrow never goes below the first step', stepRecHead(), 0);

    // ── rest grows a new clip, one step at a time ─────────────────────────
    boot();
    seqState.playing = false;              // empty clip → grow mode
    recDown();
    padOn(80, 72, 100); padOff(80);        // step 1 has a note, head → 2
    right();                               // step 2 is a rest, head → 3
    eq('rest is part of a grown clip', seqState.lenSteps, 2);
    eq('head after the rest', stepRecHead(), 2);

    // ── tie: → while the chord is held ────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    padOn(80, 72, 100);
    padOn(81, 76, 100);
    engine.ops.length = 0;
    right();
    seqEngineTick();
    eq('tie lengthens every pitch in the chord',
        engine.ops.filter((o) => o.startsWith('slen')).length, 2);
    eq('tie sets two steps of gate', engine.ops.includes('slen 0 0 0 72 48'), true);
    eq('the head follows the end of the tied note', stepRecHead(), 1);
    engine.ops.length = 0;
    right();
    seqEngineTick();
    eq('a second tie makes three steps', engine.ops.includes('slen 0 0 0 72 72'), true);
    eq('head at the end of a 3-step note', stepRecHead(), 2);
    engine.ops.length = 0;
    left();
    seqEngineTick();
    eq('untie shortens back', engine.ops.includes('slen 0 0 0 72 48'), true);
    eq('head follows the untie', stepRecHead(), 1);
    padOff(80); padOff(81);
    eq('release lands past the tied note', stepRecHead(), 2);

    // ── a note added to a tied chord joins the chord, not the head ────────
    // The head rides to the END of the tied note, so writing at the head would
    // drop the new pitch on a later step — and then lengthen it from an anchor
    // where it does not exist.
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    padOn(80, 72, 100);
    right();                               // tie: chord spans steps 0-1, head → 1
    seqEngineTick();
    engine.ops.length = 0;
    padOn(81, 76, 100);                    // add a pitch while still holding
    seqEngineTick();
    eq('a pitch added after a tie lands on the anchor',
        engine.ops.includes('addp 0 0 0 76 100'), true);
    eq('and it gets the tied length', engine.ops.includes('slen 0 0 0 76 48'), true);
    padOff(80); padOff(81);

    // ── Left is offered only when it would do something ───────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    const { stepRecCanGoLeft } = await import('../../dist/esm/seq/step-rec.js');
    eq('nothing to go back to on the first step', stepRecCanGoLeft(), false);
    padOn(80, 72, 100);
    eq('a fresh chord cannot be untied yet', stepRecCanGoLeft(), false);
    right();                               // tie
    eq('a tied chord can be untied', stepRecCanGoLeft(), true);
    left();                                // untie back to one step
    eq('and not once it is back to one step', stepRecCanGoLeft(), false);
    padOff(80);
    eq('past the first step, back is offered again', stepRecCanGoLeft(), true);

    // ── untie stops at one step ───────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    padOn(80, 72, 100);
    seqEngineTick();
    engine.ops.length = 0;
    left();
    seqEngineTick();
    eq('untie below one step is a consumed no-op',
        engine.ops.some((o) => o.startsWith('slen')), false);
    eq('the head stays put', stepRecHead(), 0);

    Date.now = realNow;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}

/* ── step recording: step buttons and Play ───────────────────────────────── */
{
    _log('\nstep record — steps & Play:');
    const { installMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep, occToggleStep } =
        await import('../../dist/esm/seq/state.js');
    const { stepRecActive, stepRecHead, resetStepRec } =
        await import('../../dist/esm/seq/step-rec.js');
    const { anyStepHeld, resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');

    const engine = installMockEngine();
    const boot = () => {
        engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec();
        resetStepEdit(); seqEngineTick();
    };
    const recDown = () => seqHandleMidi([0xB0, 86, 127], false);
    const stepDown = (b) => seqHandleMidi([0x90, 16 + b, 127], false);
    const stepUp   = (b) => seqHandleMidi([0x80, 16 + b, 0], false);

    const realNow = Date.now;
    let t = 70000;
    Date.now = () => t;

    // ── a step tap jumps the head ─────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    stepDown(6);
    eq('step press never registers as a hold', anyStepHeld(), false);
    stepUp(6);
    eq('step tap moved the head', stepRecHead(), 6);

    // ── tapping an occupied step clears it ────────────────────────────────
    occToggleStep(9);                      // pretend step 10 has notes
    seqEngineTick();
    engine.ops.length = 0;
    stepDown(9); stepUp(9);
    seqEngineTick();
    eq('occupied step is cleared', engine.ops.includes('del 0 9 9 -1'), true);
    eq('occupancy mirror cleared', occHasStep(9), false);
    eq('head landed on the cleared step', stepRecHead(), 9);

    // ── a wrap-mode tap past the clip end is inert ────────────────────────
    seqState.lenSteps = 8;
    stepDown(12); stepUp(12);
    eq('tap past the clip end does not move the head', stepRecHead(), 9);

    // ── Play leaves the mode ──────────────────────────────────────────────
    boot();
    seqState.playing = false; seqState.lenSteps = 16;
    recDown();
    seqHandleMidi([0xB0, 85, 127], false);  // Play
    eq('Play exits step recording', stepRecActive(), false);
    eq('Play still started the transport', seqState.playing, true);
    seqEngineTick();
    engine.ops.length = 0;
    seqHandleMidi([0xB0, 86, 0], false);    // the Rec release that follows
    seqEngineTick();
    eq('the trailing Rec release does not arm', engine.ops.includes('rec 0'), false);

    Date.now = realNow;
    seqState.playing = false;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}

/* ── step recording: header text ─────────────────────────────────────────── */
{
    _log('\nstep record — header:');
    const { installMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetStepRec } = await import('../../dist/esm/seq/step-rec.js');
    const { stepRecHeaderText, stepRecTick } =
        await import('../../dist/esm/seq/step-rec-view.js');
    const { seqHeaderActive, resetSeqHeader } = await import('../../dist/esm/seq/render.js');
    const { fontWidth } = await import('../../dist/esm/font/index.js');

    const engine = installMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); resetSeqHeader();
    seqEngineTick();

    const realNow = Date.now;
    let t = 80000;
    Date.now = () => t;

    seqState.playing = false; seqState.lenSteps = 16;
    seqHandleMidi([0xB0, 86, 127], false);
    eq('header names the mode and the position', stepRecHeaderText(), 'STEP REC 1/16');

    seqState.holdNotes = [60, 64, 67];
    eq('header lists the notes on the head', stepRecHeaderText(), 'STEP REC 1/16 C4 E4 G4');

    /* Transposed clips play back shifted, so the header has to show what will
     * be heard, not what is stored. */
    seqState.clipTranspose = 2;
    eq('header shows the transposed pitches', stepRecHeaderText(), 'STEP REC 1/16 D4 F#4 A4');
    seqState.clipTranspose = 0;

    /* Long chords must not run off a 128px screen. */
    seqState.holdNotes = [60, 62, 64, 65, 67, 69, 71];
    eq('header is clipped to the display width', fontWidth(stepRecHeaderText()) <= 124, true);

    /* The band is kept alive by the tick, and dies with the mode. */
    resetSeqHeader();
    stepRecTick();
    eq('the tick keeps the band up', seqHeaderActive(), true);
    seqHandleMidi([0xB0, 86, 0], false);
    resetSeqHeader();
    stepRecTick();
    eq('no band once the mode is gone', seqHeaderActive(), false);

    /* An empty clip has no length to show until the first advance. */
    seqState.holdNotes = [];
    seqState.lenSteps = 0;
    seqHandleMidi([0xB0, 86, 127], false);
    eq('an empty clip has no length to show yet', stepRecHeaderText(), 'STEP REC 1/--');
    seqHandleMidi([0xB0, 86, 0], false);

    Date.now = realNow;
    resetStepRec(); resetSeqState(); resetSeqEngine(); resetSeqHeader();
}

/* ── step recording: back-step preview ───────────────────────────────────── */
{
    _log('\nstep record — preview:');
    const { installMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetStepRec } = await import('../../dist/esm/seq/step-rec.js');
    const { stepRecTickAt } = await import('../../dist/esm/seq/step-rec-view.js');
    const { resetSeqHeader } = await import('../../dist/esm/seq/render.js');

    const engine = installMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec(); resetSeqHeader();
    seqEngineTick();

    /* Capture what movy sends to the DSP; env.mjs's version is a no-op. */
    const sent = [];
    const realSend = globalThis.shadow_send_midi_to_dsp;
    globalThis.shadow_send_midi_to_dsp = (m) => sent.push(m.slice());

    const realNow = Date.now;
    let t = 90000;
    Date.now = () => t;

    seqState.playing = false; seqState.lenSteps = 16;
    seqHandleMidi([0xB0, 86, 127], false);      // hold Rec
    seqNotePadPlayed(0, 80, 72, 100);
    seqNotePadReleased(80, 0);                  // note on step 1, head → 2

    sent.length = 0;
    seqHandleMidi([0xB0, 62, 127], false);      // Left → back to step 1
    stepRecTickAt(t);
    eq('nothing sounds before the engine answers', sent.length, 0);

    /* The engine's reply for the head step arrives on the next poll. */
    seqState.holdNotes = [72];
    seqState.holdVel = 100;
    stepRecTickAt(t);
    eq('the note on the step is previewed', sent.length, 1);
    eq('preview is a note-on for that pitch', sent[0][1], 72);
    eq('preview goes out on the track channel', sent[0][0], 0x90);

    sent.length = 0;
    stepRecTickAt(t + 100);
    eq('the preview holds for its duration', sent.length, 0);
    stepRecTickAt(t + 200);
    eq('the preview releases itself', sent.length, 1);
    eq('release is a note-off', sent[0][0], 0x80);
    eq('release matches the pitch', sent[0][1], 72);

    /* Only once per back-step: a later tick must not retrigger. */
    sent.length = 0;
    stepRecTickAt(t + 300);
    eq('the preview does not repeat', sent.length, 0);

    /* A step with nothing on it must not leave the request armed forever. */
    seqState.holdNotes = [];
    seqHandleMidi([0xB0, 62, 127], false);      // back-step onto an empty step
    stepRecTickAt(t + 400);
    stepRecTickAt(t + 1200);                    // past the give-up window
    seqState.holdNotes = [72];
    sent.length = 0;
    stepRecTickAt(t + 1300);
    eq('a stale request is dropped, not fired late', sent.length, 0);

    /* Leaving the mode with a preview still sounding must not strand it. */
    seqHandleMidi([0xB0, 62, 127], false);
    seqState.holdNotes = [72];
    stepRecTickAt(t + 1400);
    sent.length = 0;
    seqHandleMidi([0xB0, 86, 0], false);        // release Rec
    eq('exit releases a sounding preview',
        sent.some((m) => m[0] === 0x80 && m[1] === 72), true);

    globalThis.shadow_send_midi_to_dsp = realSend;
    Date.now = realNow;
    resetStepRec(); resetSeqState(); resetSeqEngine(); resetSeqHeader();
}

/* ── step recording: a grown clip is exactly as long as what was played ──── */
{
    _log('\nstep record — grow length vs the engine\'s bar rounding:');
    const { installMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetStepRec } = await import('../../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    engine.reset(); resetSeqEngine(); resetSeqState(); resetStepRec();
    /* Model the real engine's clip length: writing a note outside the window
     * rounds the clip up to that step's BAR end, and the status poll feeds that
     * back into seqState.lenSteps. Without this the mock never reports a length
     * and the bug is invisible. */
    engine.trackClipLength = true;
    engine.status.len = 0;
    seqEngineTick();

    const realNow = Date.now;
    let t = 95000;
    Date.now = () => t;

    /* Enough ticks between press and release to let a status poll land — which
     * is what happens on device, where a poll runs every 8 ticks (~40-127 ms)
     * and a pad is held far longer than that. */
    const settle = (n = 10) => { for (let i = 0; i < n; i++) seqEngineTick(); };

    seqState.playing = false;               // empty clip → grow mode
    seqHandleMidi([0xB0, 86, 127], false);  // hold Rec

    /* The very first note, while the pad is still DOWN: the clip must already
     * read one step. Trimming only on the advance leaves the engine's rounded-up
     * 16 in the mirror for as long as the pad is held, and the step row flashes
     * a full bar under the finger. */
    seqNotePadPlayed(0, 80, 60, 100);
    settle();
    eq('a held first note does not flash a full bar', seqState.lenSteps, 1);
    seqNotePadReleased(80, 0);
    settle();

    for (let i = 1; i < 6; i++) {
        seqNotePadPlayed(0, 80 + i, 60 + i, 100);
        settle();                           // the poll lands mid-note, as on device
        seqNotePadReleased(80 + i, 0);
        settle();
    }
    eq('six notes make a six-step clip', seqState.lenSteps, 6);
    eq('the engine agrees it is six steps', engine.status.len, 6);

    /* And the growth is genuinely per step, not per bar, all the way up. */
    eq('the last clen asked for six steps',
        engine.ops.filter((o) => o.startsWith('clen')).pop(), 'clen 0 6');

    /* The invariant behind the fix: a length REPORTED by the engine must never
     * suppress growth. Today the write and its trim ride in one batch so the
     * poll never sees the rounded-up value — but the moment anything splits
     * them, using the mirror as the record of intent brings the bug straight
     * back. Force the mirror to a rounded 16 and require growth to continue. */
    engine.ops.length = 0;
    seqState.lenSteps = 16;                 // as if a poll caught the rounding
    seqHandleMidi([0xB0, 63, 127], false);  // Right → rest at step 7
    seqEngineTick();
    eq('a reported length never suppresses growth',
        engine.ops.includes('clen 0 7'), true);

    seqHandleMidi([0xB0, 86, 0], false);
    Date.now = realNow;
    resetStepRec(); resetSeqState(); resetSeqEngine();
}

}
