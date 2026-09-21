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
import { appState, trackIsDrum, VIEW_CLIP_PARAMS } from '../app/state.js';
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

/* No `active` flag: being open IS `currentView === VIEW_CLIP_PARAMS`. See the
 * note in main-page.ts — two hand-synced fields are what let a page stay
 * "active" off screen and swallow every later knob turn. */
export const clipPageState = {
    touchedKnob: -1,                    // 0..3 drives the top toast; -1 none
    scaleOverlay: false,                // SCALE list open (knob 0 held)
    scaleSel: SCALE_DEFAULT_IDX,        // highlighted scale while the list is open
};

const accum = [0, 0, 0, 0];

export function clipPageActive(): boolean {
    return appState.currentView === VIEW_CLIP_PARAMS;
}

/** Drop the transient gesture state. The view switch itself belongs to
 *  param-page.ts — see clearMainPage. */
export function clearClipPage(): void {
    clipPageState.touchedKnob = -1;
    clipPageState.scaleOverlay = false;
    accum.fill(0);
}

/** @param delegated Schwung owns this knob's page (SP-53) — the long-enum
 *  scroll-and-commit-on-release overlay below is movy's OWN dive editor, and
 *  under delegation Schwung's own click-to-list-picker replaces it (SU-4: "the
 *  editor is the host's"). Touch/release bookkeeping (the toast, the undo
 *  boundary) still runs either way — see `endEdit`'s own re-entry note. */
export function clipPageTouch(k: number, down: boolean, delegated = false): void {
    clipPageState.touchedKnob = down ? k : -1;
    if (!delegated && k === 0 && down) {   // SCALE opens the long-enum overlay
        clipPageState.scaleOverlay = true;
        clipPageState.scaleSel = seqState.clipScaleIdx;
        accum[0] = 0;
    }
}

export function clipPageRelease(k: number, track: number, delegated = false): void {
    if (!delegated && k === 0 && clipPageState.scaleOverlay) {
        applyClipScaleIdx(track, clipPageState.scaleSel);
        clipPageState.scaleOverlay = false;
    }
    /* Each knob is its own undo: the key carries the knob, so turning LENGTH
     * after TRANSPOSE closes the first group rather than joining it. A group
     * that was never opened (a delegated turn writes through `applyClip*`
     * directly, same key) closes as a no-op — see `endEdit`'s own guard. */
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
    if (k === 1) applyClipLength(track, seqState.lenSteps + n);
    else if (k === 2) applyClipTranspose(track, seqState.clipTranspose + n);
    else if (k === 3) applyClipQuantIdx(track, quantIndexForPct(seqState.clipQuant) + n);
}

/*
 * THE ABSOLUTE-VALUE HALF, and the ONLY writer of these four fields.
 *
 * `clipPageKnob` above (movy's own delta gesture) and the virtual-component
 * seam's per-cell `set()` (`seq/clip-params-contract.ts`, SP-53 — Schwung
 * computes an absolute value, never a delta, and calls this with it) both
 * call these four and nothing else — one writer, two callers, gated so only
 * one is ever live for a given turn (`midi/router.ts` picks by delegation,
 * the same test the render path uses). Each clamps, no-ops on an unchanged
 * value, and opens its OWN undo gesture keyed exactly like the delta path's
 * `beginGesture` did — coalescing (`beginGesture`'s doc) still works because
 * the key is unchanged, whichever caller reaches it.
 */
export function applyClipScaleIdx(track: number, idx: number): void {
    const clamped = Math.max(0, Math.min(SCALE_RATIONALS.length - 1, idx));
    if (clamped === seqState.clipScaleIdx) return;
    beginGesture(gestureKey(0, track), KNOB_VERBS[0], trackLabel(track));
    seqState.clipScaleIdx = clamped;
    const [n, d] = SCALE_RATIONALS[clamped];
    seqCmd('cscl ' + track + ' ' + n + ' ' + d);
}

export function applyClipLength(track: number, steps: number): void {
    const next = Math.max(1, Math.min(MAX_STEPS, steps));
    if (next === seqState.lenSteps) return;
    beginGesture(gestureKey(1, track), KNOB_VERBS[1], trackLabel(track));
    seqState.lenSteps = next;
    seqCmd('clen ' + track + ' ' + next);
}

export function applyClipTranspose(track: number, semitones: number): void {
    // Inert on a drum track: its pitches are pad addresses, so transposing
    // them changes which voice fires. The engine ignores transpose there
    // (`tdrum`); the knob refuses to set a value that could never apply.
    if (trackIsDrum(track)) return;
    const next = Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, semitones));
    if (next === seqState.clipTranspose) return;
    beginGesture(gestureKey(2, track), KNOB_VERBS[2], trackLabel(track));
    seqState.clipTranspose = next;
    seqCmd('ctr ' + track + ' ' + next);
}

export function applyClipQuantIdx(track: number, idx: number): void {
    const i = Math.max(0, Math.min(QUANT_VALUES.length - 1, idx));
    const next = QUANT_VALUES[i];
    if (next === seqState.clipQuant) return;
    beginGesture(gestureKey(3, track), KNOB_VERBS[3], trackLabel(track));
    seqState.clipQuant = next;
    seqCmd('cq ' + track + ' ' + next);
}

export function resetClipPage(): void {
    clearClipPage();
    clipPageState.scaleSel = SCALE_DEFAULT_IDX;
}
