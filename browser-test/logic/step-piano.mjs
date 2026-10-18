/* browser-test/logic/step-piano.mjs — the held-step piano: which keys it shows
 * (zoom, centring, stickiness) and when it shows at all.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
    const { fitWindow, windowAt, isBlackKey } = await import('../../dist/esm/seq/piano-range.js');
    const { stepPianoVM, resetStepPiano } = await import('../../dist/esm/seq/step-piano.js');
    const { editStepDown, editStepUp, resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const top = (w) => w.lo + w.n - 1;

/* ── the window ─────────────────────────────────────────────────────────── */
{
    _log('\nstep piano window:');
    const w5 = windowAt(48, 5);
    eq('5 px slots: two octaves C..C', `${w5.lo}..${top(w5)}`, '48..72');
    ok('the last key is always white', [5, 4, 3, 2].every((k) => !isBlackKey(top(windowAt(48, k)))));
    ok('every zoom fits 128 px', [5, 4, 3, 2].every((k) => windowAt(0, k).n * k + 1 <= 128));

    const triad = fitWindow([60, 64, 67], null, 60, false);
    eq('a triad gets the widest keys', triad.k, 5);
    ok('...and is inside the window', triad.lo <= 60 && top(triad) >= 67);
    eq('...starting on a C', triad.lo % 12, 0);

    const lone = fitWindow([60], null, 60, false);
    eq('a lone note is centred, not on the left edge', lone.lo, 48);
    eq('an empty step centres on the anchor', fitWindow([], null, 62, false).lo, 48);

    const wide = fitWindow([40, 71], null, 60, false);
    ok('a wide chord narrows the keys until it fits', wide.k < 5 && wide.lo <= 40 && top(wide) >= 71);
    const huge = fitWindow([30, 90], null, 60, false);
    eq('five octaves: the narrowest keys', huge.k, 2);
}

/* ── stickiness ─────────────────────────────────────────────────────────── */
{
    _log('\nstep piano stickiness:');
    const w = fitWindow([60, 64, 67], null, 60, false);
    eq('a note added inside the window does not move it', fitWindow([60, 64, 67, 69], w, 60, true), w);
    const grown = fitWindow([60, 64, 67, 86], w, 60, true);
    ok('a note outside grows it', grown.lo <= 60 && top(grown) >= 86);
    eq('removing it again does not shrink it mid-hold', fitWindow([60, 64, 67], grown, 60, true), grown);
    eq('...but the next hold fits again', fitWindow([60, 64, 67], grown, 60, false).k, 5);
    eq('removing every note keeps the window', fitWindow([], grown, 60, true), grown);
    eq('a new empty step does not inherit dense keys', fitWindow([], grown, 60, false).k, 5);
    const other = fitWindow([62, 65], w, 60, false);
    eq('another step inside the same range keeps it', other, w);
}

/* ── when it shows ──────────────────────────────────────────────────────── */
{
    _log('\nstep piano visibility:');
    resetSeqState(); resetStepEdit(); resetStepPiano();
    eq('nothing held: no piano', stepPianoVM(), null);
    editStepDown(3);
    seqState.holdStep = 3; seqState.holdNotes = [60, 64, 67];
    const vm = stepPianoVM();
    eq('a held melodic step shows its notes', vm?.sel.join(), '60,64,67');
    ok('...centred on the screen', vm && vm.x0 >= 0 && vm.x0 + vm.win.n * vm.win.k <= 127);
    seqState.clipTranspose = 2;
    eq('notes show as they sound (clip transpose)', stepPianoVM()?.sel.join(), '62,66,69');
    seqState.clipTranspose = 0;
    seqState.holdStep = 5;
    eq('the engine still answering another step: no piano', stepPianoVM(), null);
    seqState.holdStep = 3;
    seqState.watchLane = 36;
    eq('a drum lane: no piano', stepPianoVM(), null);
    seqState.watchLane = -1;
    editStepDown(4);
    eq('two steps held: no piano', stepPianoVM(), null);
    editStepUp(4); editStepUp(3);
    eq('released: no piano', stepPianoVM(), null);
    seqState.loopMode = true;
    editStepDown(0);
    eq('Loop mode (a bar held): no piano', stepPianoVM(), null);
    resetSeqState(); resetStepEdit(); resetStepPiano();
}

/* ── a wide hold does not leak into the next ────────────────────────────── */
{
    _log('\nstep piano re-fit per hold:');
    const hold = (button, notes) => {
        editStepDown(button);
        seqState.holdStep = button;
        seqState.holdNotes = [];            // the press clears it; the engine answers later
        stepPianoVM();
        seqState.holdNotes = notes;
        return stepPianoVM();
    };
    const release = (button) => { editStepUp(button); stepPianoVM(); };
    resetSeqState(); resetStepEdit(); resetStepPiano();
    eq('a wide chord gets dense keys', hold(1, [31, 90]).win.k, 2);
    release(1);
    eq('the next narrow step gets wide keys back', hold(2, [60, 64, 67]).win.k, 5);
    seqState.holdNotes = [60, 64, 67, 90];
    const g = stepPianoVM().win;
    seqState.holdNotes = [60, 64, 67];
    eq('mid-hold it still never shrinks', stepPianoVM().win, g);
    release(2);
    eq('re-holding the SAME step re-fits too', hold(2, [60, 64, 67]).win.k, 5);
    resetSeqState(); resetStepEdit(); resetStepPiano();
}
}
