/* browser-test/logic/params-pages.mjs — the Main and Clip parameter pages, plus the UI-state persistence round trip
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    trackRef, keyboardState, installMockEngine, seqEngineTick, resetSeqEngine, appState,
    eq, lastMusicalOp, _log,
} from './harness.mjs';

export async function run() {
/* ── main params page: state machine + knob/touch/release handlers ──────── */
{
    _log('\nmain params page:');
    const {
        mainPageState, mainPageActive,
        mainPageKnob, mainPageTouch, mainPageRelease, resetMainPage,
    } = await import('../../dist/esm/seq/main-page.js');
    // The view switch belongs to the shared param-page layer, not to the page.
    const { openParamPage, closeParamPage, resetParamPage } =
        await import('../../dist/esm/seq/param-page.js');
    const { appState, VIEW_MAIN_PARAMS } = await import('../../dist/esm/app/state.js');
    const { peekSeqCmdQueue, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');
    const { resetSeqState } = await import('../../dist/esm/seq/state.js');

    // resetSeqState restores bpmX100=12000 and swingPct=50 so the tempo/swing
    // assertions below don't depend on test ordering.
    resetMainPage(); resetParamPage(); resetSeqEngine(); resetSeqState();
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    appState.currentView = 3;                  // origin the page must restore
    openParamPage(VIEW_MAIN_PARAMS);
    eq('page active after open', mainPageActive(), true);

    // Knob 0 tempo: 8 raw delta units = 1 detent = +1 BPM (bpmX100 starts 12000).
    mainPageKnob(0, 8);
    eq('tempo +1 BPM emits bpm 12100', peekSeqCmdQueue().some((c) => c.startsWith('bpm 12100')), true);
    // Knob 1 swing.
    mainPageKnob(1, 8);
    eq('swing +1 emits swing 51', peekSeqCmdQueue().some((c) => c === 'swing 51'), true);
    // Knob 2 is now LINK (moved off knob 4 by the row rearrangement).
    mainPageKnob(2, 8);
    eq('link on emits link 1', peekSeqCmdQueue().some((c) => c === 'link 1'), true);

    // Knob 4 is ROOT: cycles the pitch class, wrapping B↔C.
    keyboardState.rootPc = 11;
    mainPageKnob(4, 8);
    eq('root wraps B->C', keyboardState.rootPc, 0);
    mainPageKnob(4, -8);
    eq('root wraps C->B', keyboardState.rootPc, 11);
    keyboardState.rootPc = 0;

    // Knob 5 KEY: touch opens the overlay, turn scrolls, release commits.
    mainPageTouch(5, true);
    eq('key overlay opens on touch', mainPageState.overlayKnob, 5);
    eq('key overlay seeded from current scale', mainPageState.overlaySel, 0);
    mainPageKnob(5, 8);
    eq('key overlay scrolled', mainPageState.overlaySel, 1);
    mainPageRelease(5);
    eq('scale committed on release', keyboardState.scale, 1);
    eq('key overlay closed on release', mainPageState.overlayKnob, -1);

    // Knob 6 MODE: Chromatic → In Key.
    mainPageTouch(6, true);
    eq('mode overlay opens', mainPageState.overlayKnob, 6);
    mainPageKnob(6, 8);
    eq('mode overlay scrolled', mainPageState.overlaySel, 1);
    mainPageKnob(6, 8);
    eq('mode overlay clamps at the end', mainPageState.overlaySel, 1);
    mainPageRelease(6);
    eq('mode committed', keyboardState.mode, 1);

    // Knob 7 LAYOUT: the option list follows mode (In Key → 4ths/Inline).
    mainPageTouch(7, true);
    mainPageKnob(7, 8);
    mainPageRelease(7);
    eq('layout committed', keyboardState.layout, 1);

    // Flipping back to Chromatic keeps the index valid (both lists are length 2).
    mainPageTouch(6, true); mainPageKnob(6, -8); mainPageRelease(6);
    eq('mode back to chromatic', keyboardState.mode, 0);
    eq('layout index survives the mode flip', keyboardState.layout, 1);

    eq('close returns origin view', closeParamPage(), 3);
    eq('page inactive after close', mainPageActive(), false);
    keyboardState.scale = 0; keyboardState.mode = 0; keyboardState.layout = 0;
}

/* ── clip-scale tables ──────────────────────────────────────────────────── */
{
    _log('\nclip-scale tables:');
    const { SCALE_LABELS, SCALE_RATIONALS, scaleCellText, scaleToastText, rationalToIdx, SCALE_DEFAULT_IDX }
      = await import('../../dist/esm/seq/clip-scale.js');
    eq('8 scale values', SCALE_LABELS.length, 8);
    eq('default idx 4', SCALE_DEFAULT_IDX, 4);
    eq('idx4 is 1/1', JSON.stringify(SCALE_RATIONALS[4]), '[1,1]');
    eq('cell whole 1X', scaleCellText(4), '1X');
    eq('cell fraction 1/2', scaleCellText(2), '1/2');
    eq('toast fraction 1/2X', scaleToastText(2), '1/2X');
    eq('toast whole 2X', scaleToastText(6), '2X');
    eq('rationalToIdx 3/4 -> 3', rationalToIdx(3, 4), 3);
}

/* ── clip params page: state machine + knob/touch/release handlers ──────── */
{
    _log('\nclip params page:');
    const {
        clipPageState, clipPageActive,
        clipPageKnob, clipPageTouch, clipPageRelease, resetClipPage,
    } = await import('../../dist/esm/seq/clip-page.js');
    const { openParamPage, closeParamPage, resetParamPage } =
        await import('../../dist/esm/seq/param-page.js');
    const { appState, VIEW_CLIP_PARAMS } = await import('../../dist/esm/app/state.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');

    resetClipPage(); resetParamPage(); resetSeqEngine(); resetSeqState();
    appState.currentView = 2;                  // origin the page must restore
    openParamPage(VIEW_CLIP_PARAMS);
    eq('clip page active after open', clipPageActive(), true);
    // Transpose: knob 2, +1 detent (8 raw units) → +1 semitone + ctr command.
    seqState.clipTranspose = 0;
    clipPageKnob(2, 8, 0);
    eq('transpose +1', seqState.clipTranspose, 1);
    eq('emits ctr 0 1', peekSeqCmdQueue().some((c) => c === 'ctr 0 1'), true);
    clipPageKnob(2, -8 * 60, 0);            // drive well past -36
    eq('transpose clamped to -36', seqState.clipTranspose, -36);
    // Length: knob 1, +1 detent → +1 step + clen command.
    seqState.lenSteps = 16;
    clipPageKnob(1, 8, 0);
    eq('length +1 step', seqState.lenSteps, 17);
    eq('emits clen 0 17', peekSeqCmdQueue().some((c) => c === 'clen 0 17'), true);
    // SCALE overlay: knob 0 touch opens, scroll, release commits + emits cscl.
    seqState.clipScaleIdx = 4;
    clipPageTouch(0, true);
    eq('scale overlay opens on touch', clipPageState.scaleOverlay, true);
    clipPageKnob(0, 8, 0);                  // scroll idx 4 -> 5 (3/2)
    eq('overlay scrolled', clipPageState.scaleSel, 5);
    clipPageRelease(0, 0);
    eq('scale committed on release', seqState.clipScaleIdx, 5);
    eq('emits cscl 0 3 2', peekSeqCmdQueue().some((c) => c === 'cscl 0 3 2'), true);
    eq('overlay closed on release', clipPageState.scaleOverlay, false);
    // Close returns the origin view.
    eq('close returns origin view', closeParamPage(), 2);
    eq('clip page inactive after close', clipPageActive(), false);
}

/* ── clip params page: ViewModel ──────────────────────────────────────────── */
{
    _log('\nclip params page VM:');
    const { buildClipPageVM } = await import('../../dist/esm/seq/clip-page-vm.js');
    const { clipPageTouch, resetClipPage } = await import('../../dist/esm/seq/clip-page.js');
    const { openParamPage } = await import('../../dist/esm/seq/param-page.js');
    const { VIEW_CLIP_PARAMS } = await import('../../dist/esm/app/state.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    resetClipPage(); resetSeqState();
    seqState.clipScaleIdx = 2; seqState.lenSteps = 16; seqState.clipTranspose = 12;
    openParamPage(VIEW_CLIP_PARAMS);
    let vm = buildClipPageVM();
    eq('header is CLIP PARAMETERS', vm.headerOverride, 'CLIP PARAMETERS');
    eq('scale cell stacked text 1/2', vm.rows[0][0].displayValue, '1/2');
    eq('scale cell type len', vm.rows[0][0].type, 'len');
    eq('length cell big 16', vm.rows[0][1].displayValue, '16');
    eq('transpose cell big 12', vm.rows[0][2].displayValue, '12');
    // Toasts carry units.
    clipPageTouch(2, true);
    eq('transpose toast +12 ct', buildClipPageVM().toast.value, '+12 ct');
    clipPageTouch(1, true);
    eq('length toast 16 steps', buildClipPageVM().toast.value, '16 steps');
    clipPageTouch(0, true);                 // opens SCALE overlay
    vm = buildClipPageVM();
    eq('scale toast 1/2X', vm.toast.value, '1/2X');
    eq('overlay on slot 0', vm.overlay && vm.overlay.slot, 0);
}

/* ── clip transpose is inert on a drum track ──────────────────────────────
 * A drum module's pitches address pads, so a transpose would fire a different
 * voice (or none — schwung's per-slot transpose silences Forge exactly this
 * way). The engine ignores it there; the UI must not offer it either. */
{
    _log('\nclip transpose on drum tracks:');
    const { buildClipPageVM } = await import('../../dist/esm/seq/clip-page-vm.js');
    const { clipPageKnob, clipPageTouch, resetClipPage } = await import('../../dist/esm/seq/clip-page.js');
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

    resetClipPage(); resetSeqEngine(); resetSeqState(); resetDrumSync();
    openParamPage(VIEW_CLIP_PARAMS);
    seqState.clipTranspose = 0;
    clipPageKnob(2, 8, 0);                  // knob 2, +1 detent on the drum track
    eq('drum track: transpose knob inert', seqState.clipTranspose, 0);
    eq('drum track: no ctr command', peekSeqCmdQueue().some((c) => c.startsWith('ctr ')), false);
    clipPageKnob(2, 8, 1);                  // same gesture on the melodic track
    eq('melodic track: transpose still moves', seqState.clipTranspose, 1);
    eq('melodic track: emits ctr 1 1', peekSeqCmdQueue().some((c) => c === 'ctr 1 1'), true);

    // The cell reads as unavailable rather than showing a value that can't apply.
    appState.activeTrack = trackRef(0);
    eq('drum track: transpose cell shows n/a', buildClipPageVM().rows[0][2].displayValue, 'n/a');
    clipPageTouch(2, true);
    eq('drum track: transpose toast n/a', buildClipPageVM().toast.value, 'n/a on drums');
    appState.activeTrack = trackRef(1);
    eq('melodic track: cell shows the value', buildClipPageVM().rows[0][2].displayValue, '1');

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
    // Only the active track's model ticks, so an unvisited track's drum identity
    // is probed directly from its module id — otherwise a drum clip already
    // playing on a never-visited track would still be transposed.
    resetSeqEngine(); resetDrumSync();
    const savedGet = globalThis.shadow_get_param;
    appState.trackModels[0][1] = { ...fakeModel(true, false), getComponentKey: () => 'synth' };
    globalThis.shadow_get_param = (slot, key) => (slot === 0 && key === 'synth_module' ? 'mrdrums' : null);
    drumSyncTick();
    eq('unvisited drum track probed from its module id', peekSeqCmdQueue().some((c) => c === 'tdrum 0 1'), true);
    // …and an empty slot stays unanswered rather than being declared melodic.
    resetSeqEngine(); resetDrumSync();
    globalThis.shadow_get_param = () => null;
    drumSyncTick();
    eq('empty slot is not reported', peekSeqCmdQueue().some((c) => c.startsWith('tdrum 0')), false);

    /* Every probe is a blocking round-trip the shim only services once per SPI
     * frame (~2.7 ms), so it sets the tick period — and the tick period is the
     * knob's MIDI sampling interval. An empty slot never answers, so probing it
     * per tick spent a whole frame per empty track, every tick, forever. */
    resetSeqEngine(); resetDrumSync();
    let probeReads = 0;
    globalThis.shadow_get_param = () => { probeReads++; return null; };
    for (let i = 0; i < 200; i++) drumSyncTick();
    eq('empty slot is not re-probed every tick (' + probeReads + ' reads / 200 ticks)', probeReads <= 4, true);
    // …but it is still re-probed eventually, so a module loaded from outside
    // movy is picked up without reopening the tool.
    globalThis.shadow_get_param = (slot, key) => (slot === 0 && key === 'synth_module' ? 'mrdrums' : null);
    let found = false;
    for (let i = 0; i < 800 && !found; i++) {
        drumSyncTick();
        found = peekSeqCmdQueue().some((c) => c === 'tdrum 0 1');
    }
    eq('a module appearing in a previously empty slot is still detected', found, true);
    globalThis.shadow_get_param = savedGet;

    appState.trackModels = savedModels;
    appState.activeTrack = trackRef(0);
    resetClipPage(); resetSeqEngine(); resetSeqState(); resetDrumSync();
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
    const { mainPageKnob, resetMainPage } = await import('../../dist/esm/seq/main-page.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');
    resetMainPage();
    keyboardState.rootPc = 0; // C
    let padPaints = 0;
    const origSetLED = globalThis.setLED;
    globalThis.setLED = (idx) => { if (idx >= 68 && idx <= 99) padPaints++; }; // pad note range
    mainPageKnob(4, 8);       // +1 detent on the root knob (→ setRootPc)
    globalThis.setLED = origSetLED;
    eq('root knob turn changes rootPc', keyboardState.rootPc, 1);
    eq('root knob paints no pad LEDs (per-tick track-aware loop owns pads)', padPaints, 0);
}

/* ── main params page ViewModel ──────────────────────────────────────────── */
{
    _log('\nmain params page ViewModel:');
    const { buildMainPageVM } = await import('../../dist/esm/seq/main-page-vm.js');
    const { mainPageState, resetMainPage } = await import('../../dist/esm/seq/main-page.js');
    const { seqState } = await import('../../dist/esm/seq/state.js');
    const { keyboardState } = await import('../../dist/esm/keyboard/state.js');

    resetMainPage();
    seqState.bpmX100 = 12000; seqState.swingPct = 50;
    keyboardState.rootPc = 0; keyboardState.scale = 0; // C, Major
    keyboardState.mode = 0; keyboardState.layout = 0;
    mainPageState.active = true; mainPageState.touchedKnob = 0;
    let vm = buildMainPageVM();
    // Row 0: TEMPO SWING LINK QUANT, row 1: ROOT KEY MODE LAYOUT.
    eq('tempo cell shows 120', vm.rows[0][0].displayValue, '120');
    eq('swing cell shows 50%', vm.rows[0][1].displayValue, '50%');
    eq('link cell shows OFF', vm.rows[0][2].displayValue, 'OFF');
    eq('quant cell shows the default', vm.rows[0][3].displayValue, '0%');
    eq('root cell shows C', vm.rows[1][0].displayValue, 'C');
    eq('key cell shows Major', vm.rows[1][1].displayValue, 'Major');
    eq('mode cell shows Chromatic', vm.rows[1][2].displayValue, 'Chromatic');
    eq('layout cell shows 4th', vm.rows[1][3].displayValue, '4th');
    eq('toast names tempo', vm.toast.fullName, 'Tempo');
    eq('tempo toast value', vm.toast.value, '120 bpm');

    // Layout options follow mode.
    keyboardState.mode = 1;
    vm = buildMainPageVM();
    eq('in-key mode cell', vm.rows[1][2].displayValue, 'In Key');
    eq('in-key layout options', JSON.stringify(vm.rows[1][3].options), '["4th","Inline"]');
    keyboardState.mode = 0;

    // Overlays: one generic mechanism for KEY, MODE and LAYOUT.
    mainPageState.overlayKnob = 5; mainPageState.overlaySel = 1; mainPageState.touchedKnob = 5;
    vm = buildMainPageVM();
    eq('key overlay carries 13 scales', vm.overlay && vm.overlay.options.length, 13);
    eq('key overlay selection', vm.overlay?.selected, 1);
    eq('key overlay targets knob 5', vm.overlay?.slot, 5);

    mainPageState.overlayKnob = 6; mainPageState.overlaySel = 1; mainPageState.touchedKnob = 6;
    vm = buildMainPageVM();
    eq('mode overlay options', JSON.stringify(vm.overlay?.options), '["Chromatic","In Key"]');
    eq('mode overlay targets knob 6', vm.overlay?.slot, 6);

    mainPageState.overlayKnob = 7; mainPageState.overlaySel = 1; mainPageState.touchedKnob = 7;
    vm = buildMainPageVM();
    eq('layout overlay options', JSON.stringify(vm.overlay?.options), '["4th","Piano"]');
    resetMainPage();
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
