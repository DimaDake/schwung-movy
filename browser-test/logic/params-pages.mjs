/* browser-test/logic/params-pages.mjs — the Set/Clip parameter pages' writers
 * and tables, step entry, the UI-state persistence round trip and the CPU page.
 * (The pages themselves are Schwung's: set-/clip-params-source.mjs.)
 *
 * Run by browser-test/logic.mjs.
 */

import {
    trackRef, keyboardState, installMockEngine, seqEngineTick, resetSeqEngine, appState,
    eq, lastMusicalOp, _log,
} from './harness.mjs';

export async function run() {
/* ── clip-scale tables ──────────────────────────────────────────────────── */
{
    _log('\nclip-scale tables:');
    const { SCALE_LABELS, SCALE_RATIONALS, rationalToIdx, SCALE_DEFAULT_IDX }
      = await import('../../dist/esm/seq/clip-scale.js');
    eq('8 scale values', SCALE_LABELS.length, 8);
    eq('default idx 4', SCALE_DEFAULT_IDX, 4);
    eq('idx4 is 1/1', JSON.stringify(SCALE_RATIONALS[4]), '[1,1]');
    eq('labels carry the X', SCALE_LABELS[2] + ' ' + SCALE_LABELS[6], '1/2X 2X');
    eq('rationalToIdx 3/4 -> 3', rationalToIdx(3, 4), 3);
}

{
    _log('\nclip transpose on drum tracks:');
    const { applyClipTranspose } = await import('../../dist/esm/seq/clip-page.js');
    const { openParamPage } = await import('../../dist/esm/seq/param-page.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { appState, VIEW_CLIP_PARAMS } = await import('../../dist/esm/app/state.js');
    const { drumSyncTick, resetDrumSync } = await import('../../dist/esm/seq/drum-sync.js');

    const fakeModel = (drum, loaded = true) => ({
        getDrumConfig: () => (drum ? { padCount: 16, padNoteStart: 36, rawMidi: false } : null),
        hasLoadedParams: () => loaded,
    });
    const savedModels = appState.trackModels;
    appState.trackModels = [
        [null, fakeModel(true)],    // track 0: drum
        [null, fakeModel(false)],   // track 1: melodic
    ];

    resetSeqEngine(); resetSeqState(); resetDrumSync();
    openParamPage(VIEW_CLIP_PARAMS);
    seqState.clipTranspose = 0;
    applyClipTranspose(0, 1);               // +1 on the drum track
    eq('drum track: transpose knob inert', seqState.clipTranspose, 0);
    eq('drum track: no ctr command', peekSeqCmdQueue().some((c) => c.startsWith('ctr ')), false);
    applyClipTranspose(1, 1);               // same edit on the melodic track
    eq('melodic track: transpose still moves', seqState.clipTranspose, 1);
    eq('melodic track: emits ctr 1 1', peekSeqCmdQueue().some((c) => c === 'ctr 1 1'), true);

    // The engine is told, once per change, which tracks are drums.
    resetSeqEngine(); resetDrumSync();
    drumSyncTick();
    let q = peekSeqCmdQueue();
    eq('drum flag sent for track 0', q.some((c) => c === 'tdrum 0 1'), true);
    eq('melodic flag sent for track 1', q.some((c) => c === 'tdrum 1 0'), true);
    const n = q.length;
    drumSyncTick();
    eq('unchanged flags are not re-sent', peekSeqCmdQueue().length, n);
    appState.trackModels[1][1] = fakeModel(true);   // module swapped to a drum
    drumSyncTick();
    eq('a swap re-sends the flag', peekSeqCmdQueue().some((c) => c === 'tdrum 1 1'), true);
    /* The direct probe that used to live here is gone with the schwung host: a
     * SLOT's module could change from outside movy, so an unvisited track had
     * to be re-read from its module id. A chain can only change from inside
     * movy, so the model is the only authority and there is nothing to probe. */

    appState.trackModels = savedModels;
    appState.activeTrack = trackRef(0);
    resetSeqEngine(); resetSeqState(); resetDrumSync();
}

/* ── step entry is clamped beyond the clip length ────────────────────────── */
{
    _log('\nstep entry clamped beyond length:');
    const { installMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../../dist/esm/seq/state.js');
    const { resetStepRec } = await import('../../dist/esm/seq/step-rec.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetStepRec();
    seqEngineTick();
    const lastOp = () => lastMusicalOp(engine.ops);
    const tapStep = (b) => { seqHandleMidi([0x90, 16 + b, 127], false); seqHandleMidi([0x80, 16 + b, 0], false); };

    seqNotePadPlayed(0, 80, 72, 110);   // sets the step-entry pitch
    seqState.lenSteps = 4;              // sub-bar clip; steps 4..15 are hidden
    tapStep(8);                          // step 8 is in the hidden remainder
    seqEngineTick();
    eq('no tog for hidden sub-bar step', engine.ops.some((o) => o.startsWith('tog 0 8')), false);
    eq('occ not set beyond length', occHasStep(8), false);
    // A step within the length still places a note (and does not extend it).
    tapStep(2);
    seqEngineTick();
    eq('within-length step places note', occHasStep(2), true);
    eq('tog emitted within length', lastOp(), 'tog 0 2 72 110');
    eq('length unchanged by in-bounds entry', seqState.lenSteps, 4);
    // The next empty bar stays tappable to grow the clip (bar-aligned growth).
    seqState.lenSteps = 16; seqState.barOffset = 1;
    tapStep(0);                          // absolute step 16 → extends to bar 2
    seqEngineTick();
    eq('next empty bar still grows clip', lastOp(), 'tog 0 16 72 110');
}

/* ── held-step notes display transposed (match live pads) ─────────────────── */
{
    _log('\nheld-step transpose display:');
    const { displayHoldNotes } = await import('../../dist/esm/seq/leds.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    seqState.holdNotes = [60, 64];
    seqState.clipTranspose = 3;
    eq('hold notes shifted +3', JSON.stringify(displayHoldNotes()), '[63,67]');
    seqState.clipTranspose = 0;
    eq('no transpose passes through', JSON.stringify(displayHoldNotes()), '[60,64]');
    seqState.holdNotes = [126]; seqState.clipTranspose = 36;
    eq('clamps to MIDI 127', JSON.stringify(displayHoldNotes()), '[127]');
    resetSeqState();
}

/* ── root change never paints pads directly (drum/Session grids stay fixed) ── */
{
    _log('\nroot change does not paint pads directly:');
    const { applyRootPc } = await import('../../dist/esm/seq/main-page-apply.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');
    keyboardState.rootPc = 0; // C
    let padPaints = 0;
    const origSetLED = globalThis.setLED;
    globalThis.setLED = (idx) => { if (idx >= 68 && idx <= 99) padPaints++; }; // pad note range
    applyRootPc(1);           // the ROOT cell's write (→ setRootPc)
    globalThis.setLED = origSetLED;
    eq('root knob turn changes rootPc', keyboardState.rootPc, 1);
    eq('root knob paints no pad LEDs (per-tick track-aware loop owns pads)', padPaints, 0);
}

/* ── UI-state persistence round-trip ──────────────────────────────────── */
{
    _log('\nUI-state persistence round-trip:');
    const { serializeUiState, applyUiState } = await import('../../dist/esm/seq/ui-state.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');

    keyboardState.rootPc = 2; keyboardState.scale = 2;
    keyboardState.mode = 1; keyboardState.layout = 1;
    keyboardState.octave = [3, 5, 4, 6];
    const blob = serializeUiState();

    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
    applyUiState(blob);
    eq('root pc restored', keyboardState.rootPc, 2);
    eq('scale restored', keyboardState.scale, 2);
    eq('mode restored', keyboardState.mode, 1);
    eq('layout restored', keyboardState.layout, 1);
    /* Only the four tracks the blob carried; the rest keep the default. */
    eq('per-track octaves restored', JSON.stringify(keyboardState.octave.slice(0, 4)), '[3,5,4,6]');

    // A legacy blob has one absolute `root` and no oct/mode/layout: derive the
    // tonic and give every track that octave. Existing sets must keep working.
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 1; keyboardState.layout = 1;
    keyboardState.octave = new Array(16).fill(1);
    applyUiState(JSON.stringify({ root: 50, scale: 3 }));
    eq('legacy root gives pitch class', keyboardState.rootPc, 2);
    /* "every" means every track, not just the first four — a legacy blob has one
     * absolute note that has to reach all 16. */
    eq('legacy root fills every octave',
       keyboardState.octave.every((o) => o === 4) && keyboardState.octave.length === 16, true);
    eq('legacy scale restored', keyboardState.scale, 3);
    eq('legacy blob resets mode', keyboardState.mode, 0);
    eq('legacy blob resets layout', keyboardState.layout, 0);

    // Missing fields keep the current value where there is nothing to derive.
    keyboardState.scale = 1;
    applyUiState('{"root":36}');
    eq('partial blob updates root', keyboardState.rootPc, 0);
    eq('partial blob keeps scale', keyboardState.scale, 1);

    // Out-of-range values are clamped, never trusted.
    applyUiState(JSON.stringify({ rootPc: 99, oct: [-3, 99, 4, 4], scale: 999, mode: 7, layout: 7 }));
    eq('rootPc clamped into 0..11', keyboardState.rootPc, 3);
    eq('octave clamped low', keyboardState.octave[0], 0);
    eq('octave clamped high', keyboardState.octave[1], 8);
    eq('scale clamped', keyboardState.scale, 12);
    eq('mode clamped', keyboardState.mode, 1);
    eq('layout clamped', keyboardState.layout, 1);

    // Corrupt input must not throw or mutate.
    keyboardState.rootPc = 5;
    applyUiState('{not json');
    eq('corrupt blob leaves state alone', keyboardState.rootPc, 5);

    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
}

/* ── CPU page: Shift+Step 12 ─────────────────────────────────────────────── */
{
    _log('\ncpu page: open, re-press, close');
    const { openCpuPage, cpuPageActive } = await import('../../dist/esm/seq/cpu-page.js');
    const { closeParamPage, paramPageActive, resetParamPage } =
        await import('../../dist/esm/seq/param-page.js');
    const { appState, VIEW_CPU, VIEW_CHAIN } = await import('../../dist/esm/app/state.js');
    const { peekSeqCmdQueue, resetSeqEngine } =
        await import('../../dist/esm/seq/engine.js');
    /* COUNTED, not "is it in there". seqCmdFlush() no-ops until the engine has
     * booted, so draining between the two presses is not available here — and a
     * membership check would let the second assertion pass on the FIRST press's
     * command, proving nothing about the re-press. */
    const resets = () => peekSeqCmdQueue().filter((op) => op === 'cpurst').length;

    resetParamPage(); resetSeqEngine();
    installMockEngine();
    appState.currentView = VIEW_CHAIN;

    openCpuPage();
    eq('Shift+Step 12 opens the CPU page', appState.currentView, VIEW_CPU);
    eq('the page knows it is up', cpuPageActive(), true);
    eq('the CPU page is a param-page sibling', paramPageActive(), true);
    eq('opening resets the held peaks', resets(), 1);

    /* Pressing again while it is up is the meter's "clear peaks" — the gesture
     * a hardware meter puts on its own button. openParamPage() returns early
     * when the view is already up, so the reset has to be sent BESIDE it. */
    openCpuPage();
    eq('a second press stays on the page', appState.currentView, VIEW_CPU);
    eq('and clears the peaks again', resets(), 2);

    /* Back leaves the layer for the view it was entered from — the same one
     * gesture that leaves Set Params, Clip Params and Settings. */
    appState.currentView = closeParamPage();
    eq('Back leaves for the origin', appState.currentView, VIEW_CHAIN);
    eq('and the page knows it is gone', cpuPageActive(), false);

    /* The binding itself, through the router — everything above would pass with
     * Shift+Step 12 wired to nothing at all. */
    const { handleStepButton } = await import('../../dist/esm/seq/router-steps.js');
    const { STEP_CPU } = await import('../../dist/esm/seq/constants.js');
    handleStepButton(STEP_CPU, true, true);
    eq('the step row reaches the page', appState.currentView, VIEW_CPU);
    handleStepButton(STEP_CPU, false, true);

    /* An UNSHIFTED step 12 is a note, not the page. */
    appState.currentView = closeParamPage();
    handleStepButton(STEP_CPU, true, false);
    handleStepButton(STEP_CPU, false, false);
    eq('and only with Shift', appState.currentView, VIEW_CHAIN);
}


}
