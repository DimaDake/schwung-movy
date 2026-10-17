/* Clip Parameters page: per-clip Scale / Length / Transpose / Quantize, opened
 * with Shift+Step 3 in Track view, closed with Back or a Session-view switch.
 * Schwung draws it from a virtual contract (`clip-params-contract.ts`, SP-53);
 * the writers below edit the active track's playing clip via engine commands,
 * and seqState mirrors the values. */

import { seqState } from './state.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
import { trackLabel } from '../undo/label.js';
import { seqCmd } from './engine.js';
import { appState, trackIsDrum, VIEW_CLIP_PARAMS } from '../app/state.js';
import { MAX_STEPS } from './constants.js';
import { SCALE_RATIONALS } from './clip-scale.js';
import { QUANT_VALUES } from './quant.js';

const TRANSPOSE_MIN = -36, TRANSPOSE_MAX = 36;

/* One undo per knob: the key carries the knob, so turning LENGTH after
 * TRANSPOSE closes the first group instead of joining it, and each release
 * commits its own entry. */
const KNOB_VERBS: Record<number, string> = {
    0: 'CLIP SCALE', 1: 'CLIP LENGTH', 2: 'TRANSPOSE', 3: 'CLIP QUANT',
};
const gestureKey = (k: number, track: number) => 'clip:' + track + ':' + k;

/* No `active` flag: being open IS `currentView === VIEW_CLIP_PARAMS` (see
 * main-page.ts). */
export function clipPageActive(): boolean {
    return appState.currentView === VIEW_CLIP_PARAMS;
}

/* A group that was never opened closes as a no-op — see `endEdit`'s guard. */
export function clipPageRelease(k: number, track: number): void {
    endEdit(gestureKey(k, track));
}

/* The writers the virtual contract's per-cell `set()` calls with an absolute
 * value (SP-53). Each clamps, no-ops on an unchanged value, and opens its own
 * undo gesture keyed per knob, so a whole turn coalesces into one entry. */
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
