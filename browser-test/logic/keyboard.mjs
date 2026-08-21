/* browser-test/logic/keyboard.mjs — the step page, scales, pad layouts, pad colours and per-track octaves
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    keyboardState, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── step page: held trig values parse into the mirror ───────────────────── */
{
    _log('\nstep page status parse:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=0 trk=0 step=3 hvel=100 hgate=48 hgmix=1 hprob=40 hcond=2:3 hinv=1');
    eq('holdVel parsed', seqState.holdVel, 100);
    eq('holdGate parsed', seqState.holdGate, 48);
    eq('holdGateMixed parsed', seqState.holdGateMixed, true);
    eq('holdProb parsed', seqState.holdProb, 40);
    eq('holdCondA parsed', seqState.holdCondA, 2);
    eq('holdCondB parsed', seqState.holdCondB, 3);
    eq('holdInvert parsed', seqState.holdInvert, true);
}

/* ── step page: session-memory selection rule ────────────────────────────── */
{
    _log('\nstep page memory:');
    const { stepPageState, onSessionStart, onSessionEnd, setStepPageSelected, resetStepPage } =
        await import('../../dist/esm/seq/step-page.js');
    resetStepPage();
    onSessionStart();
    eq('first session defaults to module page', stepPageState.selected, false);
    setStepPageSelected(true);
    onSessionEnd();
    onSessionStart();
    eq('step page reopens after a step-page session', stepPageState.selected, true);
    setStepPageSelected(false);
    onSessionEnd();
    onSessionStart();
    eq('module-page session does not reopen step page', stepPageState.selected, false);
}

/* ── step page: ViewModel builder + value mappings ───────────────────────── */
{
    _log('\nstep page viewmodel:');
    const { buildStepPageVM, LENGTH_TICKS, lengthIndexForTicks } =
        await import('../../dist/esm/seq/step-page-vm.js');
    eq('48 ticks -> 1/8 index', lengthIndexForTicks(48), 2);
    eq('length list 1/8 = 48 ticks', LENGTH_TICKS[2], 48);
    const vm = buildStepPageVM({
        holdVel: 100, holdGate: 48, holdGateMixed: false,
        holdProb: 40, holdCondA: 2, holdCondB: 3, holdInvert: true,
    });
    eq('title is step', vm.moduleName, 'step');
    const c = vm.rows[0];
    eq('velocity = vbar', c[0].renderStyle, 'vbar');
    eq('velocity bar at avg', Math.abs(c[0].normalizedValue - 100 / 127) < 0.01, true);
    eq('length = len (fraction render)', c[1].type, 'len');
    eq('length shows 1/8', c[1].displayValue, '1/8');
    eq('probability shows 40%', c[2].displayValue, '40%');
    eq('condition = preset', c[3].renderStyle, 'preset');
    eq('condition shows 2:3', c[3].displayValue, '2:3');
    eq('invert ON', vm.rows[1][0].displayValue, 'ON');
    const vm2 = buildStepPageVM({ holdVel: 80, holdGate: 24, holdGateMixed: true,
        holdProb: 100, holdCondA: 1, holdCondB: 1, holdInvert: false });
    eq('mixed length shows ...', vm2.rows[0][1].displayValue, '...');
}

/* ── step page: a touched knob produces the shared top toast ──────────────── */
{
    _log('\nstep page toast:');
    const { buildStepPageVM } = await import('../../dist/esm/seq/step-page-vm.js');
    const { stepPageState, setStepTouchedKnob } = await import('../../dist/esm/seq/step-page.js');
    const h = { holdVel: 90, holdGate: 96, holdGateMixed: false,
        holdProb: 70, holdCondA: 1, holdCondB: 2, holdInvert: false };
    setStepTouchedKnob(-1);
    eq('no toast when nothing touched', buildStepPageVM(h).toast, null);
    setStepTouchedKnob(2);                 // probability knob
    const t = buildStepPageVM(h).toast;
    eq('touched knob → toast name', t.fullName, 'Probability');
    eq('touched knob → toast value', t.value, '70%');
    setStepTouchedKnob(-1);
    stepPageState.touchedKnob = -1;
}

/* ── chromatic pad: root highlight follows baseNote pitch class ──────────── */
{
    _log('\nchromatic pad root highlight:');
    const { padColor } = await import('../../dist/esm/seq/pads.js');
    const { keyboardState, resetPadMapCache } = await import('../../dist/esm/keyboard/state.js');
    // The root highlight keys on the tonic's pitch class, not on C: transposing
    // the tonic to D must move the track-coloured pads with it.
    keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
    keyboardState.octave = [4, 4, 4, 4];
    keyboardState.rootPc = 2; resetPadMapCache();
    const ROOT_T0 = padColor(71, 68, 0, false);   // D major, root pad
    keyboardState.rootPc = 0; resetPadMapCache();
    const trackCol = padColor(71, 68, 0, false);  // C major, root pad
    eq('root highlight follows the tonic pitch class', ROOT_T0, trackCol);
}

/* ── scales: musical scale definitions and in-scale testing ─────────────── */
{
    _log('\nscales:');
    const { SCALES, SCALE_NAMES, inScaleFor } = await import('../../dist/esm/seq/scales.js');
    eq('thirteen scales', SCALES.length, 13);
    eq('first scale is Major', SCALE_NAMES[0], 'Major');
    // Major anchored to D (root 2): D E F# G A B C# in scale; F natural (5) out.
    eq('root in scale', inScaleFor(2, 2, 0), true);     // D
    eq('F# in D major', inScaleFor(6, 2, 0), true);     // F#
    eq('F natural out of D major', inScaleFor(5, 2, 0), false);
    // Chromatic (index 12): everything in scale.
    eq('chromatic admits all', inScaleFor(5, 2, 12), true);
}

/* ── pad layouts: grid geometry for every mode/layout combination ────────── */
{
    _log('\npad layouts:');
    const {
        buildPadMap, degreeToPitch, layoutNames, isPianoLayout,
        MODE_CHROMATIC, MODE_IN_KEY, LAYOUT_FOURTHS, LAYOUT_PIANO, LAYOUT_INLINE,
        MODE_NAMES, PAD_COUNT,
    } = await import('../../dist/esm/keyboard/layouts.js');

    // Row 0 is the BOTTOM row; index 0 is bottom-left.
    const row = (map, r) => Array.from(map.slice(r * 8, r * 8 + 8));

    eq('mode names', JSON.stringify(MODE_NAMES), '["Chromatic","In Key"]');
    eq('chromatic layouts', JSON.stringify(layoutNames(MODE_CHROMATIC)), '["4th","Piano"]');
    eq('in-key layouts', JSON.stringify(layoutNames(MODE_IN_KEY)), '["4th","Inline"]');

    // ── Chromatic / 4ths: +1 per column, +5 per row, root on column 4.
    // base 60 (C4) → bottom-left is 57 (A3), so the root sits at index 3.
    {
        const m = buildPadMap(MODE_CHROMATIC, LAYOUT_FOURTHS, 0, 60);
        eq('chrom 4ths bottom row', JSON.stringify(row(m, 0)), '[57,58,59,60,61,62,63,64]');
        eq('chrom 4ths root at col 4', m[3], 60);
        eq('chrom 4ths row step is a fourth', m[8] - m[0], 5);
        eq('chrom 4ths top-left', m[24], 72);
    }

    /* A base that is not a number must produce dead pads. NaN compares false
     * against every bound, so the old range test let it through and the
     * Int16Array stored it as 0 — a whole grid silently playing MIDI note 0. */
    {
        const m = buildPadMap(MODE_CHROMATIC, LAYOUT_FOURTHS, 0, NaN);
        eq('NaN base yields dead pads, not note 0',
            Array.from(m).every((p) => p === -1), true);
    }

    // ── Chromatic / Piano: whites on rows 0/2, blacks on rows 1/3 shifted right
    // (C# above D). Cols 0, 3 and 7 of a black row are dead. Rows 2-3 are +12.
    {
        const m = buildPadMap(MODE_CHROMATIC, LAYOUT_PIANO, 0, 60);
        eq('piano white row', JSON.stringify(row(m, 0)), '[60,62,64,65,67,69,71,72]');
        eq('piano black row', JSON.stringify(row(m, 1)), '[-1,61,63,-1,66,68,70,-1]');
        eq('piano upper white row', JSON.stringify(row(m, 2)), '[72,74,76,77,79,81,83,84]');
        eq('piano upper black row', JSON.stringify(row(m, 3)), '[-1,73,75,-1,78,80,82,-1]');
        eq('piano root bottom-left', m[0], 60);
        eq('isPianoLayout on', isPianoLayout(MODE_CHROMATIC, LAYOUT_PIANO), true);
        eq('isPianoLayout off in 4ths', isPianoLayout(MODE_CHROMATIC, LAYOUT_FOURTHS), false);
        eq('isPianoLayout off in key mode', isPianoLayout(MODE_IN_KEY, LAYOUT_PIANO), false);
    }

    // ── In Key / 4ths: +3 scale degrees per row, root bottom-left.
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_FOURTHS, 0, 60);
        eq('key 4ths bottom row', JSON.stringify(row(m, 0)), '[60,62,64,65,67,69,71,72]');
        eq('key 4ths row1 starts on F', JSON.stringify(row(m, 1)), '[65,67,69,71,72,74,76,77]');
        eq('key 4ths row2 starts on B', JSON.stringify(row(m, 2)), '[71,72,74,76,77,79,81,83]');
        eq('key 4ths root bottom-left', m[0], 60);
        eq('key 4ths never out of scale',
            row(m, 3).every((p) => [0, 2, 4, 5, 7, 9, 11].includes(((p - 60) % 12 + 12) % 12)), true);
    }

    // ── In Key / Inline: row step = the scale's own degree count, so each row
    // is exactly one octave up for a 7-note scale.
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 0, 60);
        eq('key inline bottom row', JSON.stringify(row(m, 0)), '[60,62,64,65,67,69,71,72]');
        eq('key inline row1 is an octave up', JSON.stringify(row(m, 1)), '[72,74,76,77,79,81,83,84]');
        eq('key inline row3 is 3 octaves up', m[24] - m[0], 36);
    }

    // ── Minor (index 1, [0,2,3,5,7,8,10]) folds correctly.
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 1, 60);
        eq('c minor inline bottom row', JSON.stringify(row(m, 0)), '[60,62,63,65,67,68,70,72]');
    }

    // ── Minor pentatonic (index 10, [0,3,5,7,10]) has 5 degrees, so Inline
    // steps 5 per row and rows overlap — the documented behaviour.
    {
        const m = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 10, 60);
        eq('min penta inline bottom row', JSON.stringify(row(m, 0)), '[60,63,65,67,70,72,75,77]');
        eq('min penta inline row step is 5 degrees', m[8], 72);
    }

    // ── degreeToPitch wraps octaves in both directions.
    {
        const maj = [0, 2, 4, 5, 7, 9, 11];
        eq('degree 0', degreeToPitch(60, maj, 0), 60);
        eq('degree 7 wraps an octave', degreeToPitch(60, maj, 7), 72);
        eq('degree 15 wraps two octaves', degreeToPitch(60, maj, 15), 86);
        eq('degree -1 wraps down', degreeToPitch(60, maj, -1), 59);
    }

    // ── Pitches outside 0..127 become dead pads, never clamped notes.
    {
        const m = buildPadMap(MODE_CHROMATIC, LAYOUT_FOURTHS, 0, 2);
        eq('below 0 is dead', m[0], -1);
        const hi = buildPadMap(MODE_IN_KEY, LAYOUT_INLINE, 0, 120);
        eq('above 127 is dead', hi[PAD_COUNT - 1], -1);
    }
}

/* ── keyboard state: per-track octave + pad-map cache ───────────────────── */
{
    _log('\nkeyboard state:');
    const { keyboardState, baseNoteFor, padMapFor, padMapBuildCount, resetPadMapCache, OCT_MIN, OCT_MAX }
        = await import('../../dist/esm/keyboard/state.js');

    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
    resetPadMapCache();

    eq('default base is C3', baseNoteFor(0), 48);
    eq('octave range', OCT_MIN + '-' + OCT_MAX, '0-8');

    // Per-track: changing one track's octave must not move another's.
    keyboardState.octave[1] = 2;
    eq('track 0 unchanged', baseNoteFor(0), 48);
    eq('track 1 moved down two octaves', baseNoteFor(1), 24);

    // Tonic is global — it moves every track's base together.
    keyboardState.rootPc = 3;
    eq('root pc shifts track 0', baseNoteFor(0), 51);
    eq('root pc shifts track 1', baseNoteFor(1), 27);
    keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];

    // Cache: rebuilt only when one of its inputs changes. The per-tick LED loop
    // calls padMapFor at ~205 Hz, so a rebuild per call would be pure waste.
    resetPadMapCache();
    const b0 = padMapBuildCount();
    for (let i = 0; i < 500; i++) padMapFor(0);
    eq('500 unchanged calls build once', padMapBuildCount() - b0, 1);
    keyboardState.octave[0] = 5;
    padMapFor(0);
    eq('octave change rebuilds', padMapBuildCount() - b0, 2);
    keyboardState.octave[0] = 4;
    padMapFor(0);
    keyboardState.mode = 1;
    padMapFor(0);
    eq('mode change rebuilds', padMapBuildCount() - b0, 4);
    keyboardState.layout = 1;
    padMapFor(0);
    eq('layout change rebuilds', padMapBuildCount() - b0, 5);
    keyboardState.scale = 2;
    padMapFor(0);
    eq('scale change rebuilds', padMapBuildCount() - b0, 6);
    // Same octave as track 0 → same base → the cache key matches, no rebuild.
    padMapFor(1);
    eq('other track on the same octave reuses the map', padMapBuildCount() - b0, 6);

    keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
    keyboardState.octave = [4, 4, 4, 4];
    resetPadMapCache();
    eq('map is 32 entries', padMapFor(0).length, 32);
}

/* ── pad colours: root / scale / piano blacks / dead pads ───────────────── */
{
    _log('\npad colours:');
    const { padColor, padPitch } = await import('../../dist/esm/seq/pads.js');
    const { keyboardState, resetPadMapCache } = await import('../../dist/esm/keyboard/state.js');

    const C_BLACK = 0, C_WHITE = 120, C_DARKGREY = 124, C_LIGHTGREY = 118, C_GREEN = 11;
    const TRACK0 = 65;  // track 1 = Bright Red dim
    const PAD_MIN = 68;

    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
    resetPadMapCache();

    // Chromatic 4ths, base 48: bottom-left is 45 (A2), root C3 at index 3.
    eq('pitch bottom-left', padPitch(0, PAD_MIN, PAD_MIN), 45);
    eq('pitch at root column', padPitch(0, PAD_MIN + 3, PAD_MIN), 48);
    eq('root pad is track colour', padColor(PAD_MIN + 3, PAD_MIN, 0, false), TRACK0);
    eq('in-scale pad is light grey', padColor(PAD_MIN + 5, PAD_MIN, 0, false), C_LIGHTGREY); // D
    eq('out-of-scale pad is dark', padColor(PAD_MIN + 4, PAD_MIN, 0, false), C_BLACK);       // C#
    eq('sounding pad is green', padColor(PAD_MIN + 3, PAD_MIN, 0, true), C_GREEN);
    eq('hold overlay pad is white', padColor(PAD_MIN + 3, PAD_MIN, 0, false, [48]), C_WHITE);

    // Piano (layout index 1) needs three visible levels: a gap pad plays nothing
    // and stays dark, an out-of-key pad DOES play so it is lit dimly, and an
    // in-key pad is bright. Which row a pad is in already says white vs black.
    keyboardState.layout = 1; resetPadMapCache();
    eq('piano root still track colour', padColor(PAD_MIN, PAD_MIN, 0, false), TRACK0);
    eq('piano white D is light grey', padColor(PAD_MIN + 1, PAD_MIN, 0, false), C_LIGHTGREY);
    eq('piano gap col 0 is dead', padColor(PAD_MIN + 8, PAD_MIN, 0, false), C_BLACK);
    eq('piano out-of-key C# is dim, not dark', padColor(PAD_MIN + 9, PAD_MIN, 0, false), C_DARKGREY);
    // The whole point: a playable out-of-key pad must not look like a dead one.
    eq('piano out-of-key differs from a gap',
        padColor(PAD_MIN + 9, PAD_MIN, 0, false) !== padColor(PAD_MIN + 8, PAD_MIN, 0, false), true);
    // With the Chromatic scale (index 12) every playable pad is in key.
    keyboardState.scale = 12; resetPadMapCache();
    eq('piano black lights bright in chromatic scale', padColor(PAD_MIN + 9, PAD_MIN, 0, false), C_LIGHTGREY);
    eq('piano white lights bright in chromatic scale', padColor(PAD_MIN + 1, PAD_MIN, 0, false), C_LIGHTGREY);
    eq('piano gap stays dead in chromatic scale', padColor(PAD_MIN + 8, PAD_MIN, 0, false), C_BLACK);
    // Non-piano layouts keep out-of-scale fully dark.
    keyboardState.scale = 0; keyboardState.layout = 0; resetPadMapCache();
    eq('4ths out-of-scale stays dark', padColor(PAD_MIN + 4, PAD_MIN, 0, false), C_BLACK);

    // In Key: every pad is in scale, so nothing is dark except dead pads.
    keyboardState.mode = 1; keyboardState.layout = 0; keyboardState.scale = 0;
    resetPadMapCache();
    eq('key mode root bottom-left', padColor(PAD_MIN, PAD_MIN, 0, false), TRACK0);
    eq('key mode non-root is light grey', padColor(PAD_MIN + 1, PAD_MIN, 0, false), C_LIGHTGREY);

    keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
    resetPadMapCache();
}

/* ── octave buttons: per-track, clamped ─────────────────────────────────── */
{
    _log('\noctave buttons:');
    const { changeOctave, setRootPc } = await import('../../dist/esm/keyboard/handler.js');
    const { keyboardState, OCT_MIN, OCT_MAX } = await import('../../dist/esm/keyboard/state.js');

    keyboardState.octave = [4, 4, 4, 4];
    changeOctave(1, 1);
    eq('shifts only the named track', JSON.stringify(keyboardState.octave), '[4,5,4,4]');
    changeOctave(1, -1);
    eq('shifts back', JSON.stringify(keyboardState.octave), '[4,4,4,4]');

    keyboardState.octave[2] = OCT_MAX;
    changeOctave(2, 1);
    eq('clamps at the top', keyboardState.octave[2], OCT_MAX);
    keyboardState.octave[2] = OCT_MIN;
    changeOctave(2, -1);
    eq('clamps at the bottom', keyboardState.octave[2], OCT_MIN);
    keyboardState.octave = [4, 4, 4, 4];

    setRootPc(13);
    eq('root pc wraps above B', keyboardState.rootPc, 1);
    setRootPc(-1);
    eq('root pc wraps below C', keyboardState.rootPc, 11);
    setRootPc(0);
}

}
