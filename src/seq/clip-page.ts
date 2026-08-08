/* Clip Parameters page: per-clip Scale / Length / Transpose / Quantize on
 * knobs 0-3,
 * opened with Shift+Step 3 in Track view, closed with Back or a Session-view
 * switch. Mirrors main-page.ts; rendering reads clip-page-vm. Edits the active
 * track's playing clip via engine commands; seqState mirrors the values. */

import { seqState } from './state.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
import { trackLabel } from '../undo/label.js';
import { seqCmd } from './engine.js';
import { trackIsDrum } from '../app/state.js';
import { countDetents } from './detent.js';
import { MAX_STEPS } from './constants.js';
import { SCALE_RATIONALS, SCALE_DEFAULT_IDX } from './clip-scale.js';
import { QUANT_VALUES, quantIndexForPct } from './quant.js';

const TRANSPOSE_MIN = -36, TRANSPOSE_MAX = 36;

/* One undo per knob: the key carries the knob, so turning LENGTH after
 * TRANSPOSE closes the first group instead of joining it, and each release
 * commits its own entry. */
const KNOB_VERBS: Record<number, string> = {
    0: 'CLIP SCALE', 1: 'CLIP LENGTH', 2: 'TRANSPOSE', 3: 'CLIP QUANT',
};
const gestureKey = (k: number, track: number) => 'clip:' + track + ':' + k;

export const clipPageState = {
    active: false,
    origin: 0,                          // view to restore on Back
    touchedKnob: -1,                    // 0..3 drives the top toast; -1 none
    scaleOverlay: false,                // SCALE list open (knob 0 held)
    scaleSel: SCALE_DEFAULT_IDX,        // highlighted scale while the list is open
};

const accum = [0, 0, 0, 0];

export function clipPageActive(): boolean { return clipPageState.active; }

export function openClipPage(origin: number, _track: number): void {
    clipPageState.active = true;
    clipPageState.origin = origin;
    clipPageState.touchedKnob = -1;
    clipPageState.scaleOverlay = false;
    accum.fill(0);
}

/** Close the page; returns the origin view the caller should restore. */
export function closeClipPage(): number {
    clipPageState.active = false;
    clipPageState.touchedKnob = -1;
    clipPageState.scaleOverlay = false;
    return clipPageState.origin;
}

export function clipPageTouch(k: number, down: boolean): void {
    clipPageState.touchedKnob = down ? k : -1;
    if (k === 0 && down) {              // SCALE opens the long-enum overlay
        clipPageState.scaleOverlay = true;
        clipPageState.scaleSel = seqState.clipScaleIdx;
        accum[0] = 0;
    }
}

export function clipPageRelease(k: number, track: number): void {
    if (k === 0 && clipPageState.scaleOverlay) {
        const idx = clipPageState.scaleSel;
        if (idx !== seqState.clipScaleIdx) {
            /* SCALE commits on release, so its group opens here rather than on
             * the turn — the sweep through the overlay changes nothing until
             * the knob is let go. */
            beginGesture(gestureKey(k, track), KNOB_VERBS[k], trackLabel(track));
            seqState.clipScaleIdx = idx;
            const [n, d] = SCALE_RATIONALS[idx];
            seqCmd('cscl ' + track + ' ' + n + ' ' + d);
        }
        clipPageState.scaleOverlay = false;
    }
    /* Each knob is its own undo: the key carries the knob, so turning LENGTH
     * after TRANSPOSE closes the first group rather than joining it. */
    endEdit(gestureKey(k, track));
    if (clipPageState.touchedKnob === k) clipPageState.touchedKnob = -1;
}

export function clipPageKnob(k: number, delta: number, track: number): void {
    clipPageState.touchedKnob = k;
    const n = countDetents(accum, k, delta);
    if (n === 0) return;
    if (k === 0 && clipPageState.scaleOverlay) {
        /* No group yet — the overlay only moves a selection; the edit happens
         * on release (clipPageRelease). */
        clipPageState.scaleSel = Math.max(0, Math.min(SCALE_RATIONALS.length - 1, clipPageState.scaleSel + n));
        return;
    }
    if (KNOB_VERBS[k]) beginGesture(gestureKey(k, track), KNOB_VERBS[k], trackLabel(track));
    if (k === 1) {
        const next = Math.max(1, Math.min(MAX_STEPS, seqState.lenSteps + n));
        if (next !== seqState.lenSteps) { seqState.lenSteps = next; seqCmd('clen ' + track + ' ' + next); }
    } else if (k === 2 && !trackIsDrum(track)) {
        // Inert on a drum track: its pitches are pad addresses, so transposing
        // them changes which voice fires. The engine ignores transpose there
        // (`tdrum`); the knob refuses to set a value that could never apply.
        const next = Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, seqState.clipTranspose + n));
        if (next !== seqState.clipTranspose) { seqState.clipTranspose = next; seqCmd('ctr ' + track + ' ' + next); }
    } else if (k === 3) {
        const i = Math.max(0, Math.min(QUANT_VALUES.length - 1,
            quantIndexForPct(seqState.clipQuant) + n));
        const next = QUANT_VALUES[i];
        if (next !== seqState.clipQuant) { seqState.clipQuant = next; seqCmd('cq ' + track + ' ' + next); }
    }
}

export function resetClipPage(): void {
    clipPageState.active = false;
    clipPageState.origin = 0;
    clipPageState.touchedKnob = -1;
    clipPageState.scaleOverlay = false;
    clipPageState.scaleSel = SCALE_DEFAULT_IDX;
    accum.fill(0);
}
