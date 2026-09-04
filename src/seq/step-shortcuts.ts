/* The shifted step functions: Shift + a step button, Move's own convention.
 *
 * Split out of router-steps.ts because two different branches now reach them —
 * the step row in Track view, and the TRACK SELECTOR in Session view, where the
 * row means tracks but Shift still means these. They are global: the only one
 * that is not is Clip Params, which edits a single clip and so has nowhere to
 * point in Session view. */

import { appState, VIEW_MAIN_PARAMS, VIEW_CLIP_PARAMS, VIEW_FLAGS } from '../app/state.js';
import { beginGesture } from '../undo/edit.js';
import { trackLabel } from '../undo/label.js';
import {
    MAIN_PAGE_STEPS, STEP_CLIP_PARAMS, STEP_FLAGS, STEP_METRO,
    STEP_FULL_VEL, STEP_DOUBLE_LOOP, STEP_QUANTIZE, STEP_CPU,
} from './constants.js';
import { openCpuPage } from './cpu-page.js';
import { openParamPage } from './param-page.js';
import { seqCmd } from './engine.js';
import { doubleLoop } from './loop-mode.js';
import { seqToast } from './render.js';
import { seqState, setFullVelocity } from './state.js';
import { nextQuantCandidate } from './quant.js';
import { armQuantOverlay } from './quant-overlay.js';
import { watchedTrack } from './watch.js';

/* Shift + step button = Move's shifted step functions. Step 10 toggles Full
 * Velocity; further entries (Double Loop = Step 15, Quantize = Step 16) land
 * in later steps. Steps 5/7/9 (0-indexed 4/6/8) open the Main Params page. */
export function shiftStepFunction(step: number): void {
    if (step in MAIN_PAGE_STEPS) {
        openParamPage(VIEW_MAIN_PARAMS);
        appState.dirty = true;
        return;
    }
    /* Settings. Reachable in every build — what a release build hides is the
     * measurement flags on it, not the page (flags-visible.ts). */
    if (step === STEP_FLAGS) {
        openParamPage(VIEW_FLAGS);
        appState.dirty = true;
        return;
    }
    // Clip Params edits the active/playing clip, so it only opens in Track view
    // (Session view shows the clip grid, not a single clip's params).
    if (step === STEP_CLIP_PARAMS) {
        if (!seqState.sessionMode) openParamPage(VIEW_CLIP_PARAMS);
        appState.dirty = true;
        return;
    }
    if (step === STEP_CPU) {
        openCpuPage();
        appState.dirty = true;
        return;
    }
    if (step === STEP_FULL_VEL) {
        setFullVelocity(!seqState.fullVelocity);
        seqToast(seqState.fullVelocity ? 'Full Velocity On' : 'Full Velocity Off');
    } else if (step === STEP_DOUBLE_LOOP) {
        doubleLoop();
    } else if (step === STEP_METRO) {
        seqCmd('metro ' + (seqState.metro ? 0 : 1));
        seqToast(seqState.metro ? 'Metronome Off' : 'Metronome On');
    } else if (step === STEP_QUANTIZE) {
        cycleQuantize();
    }
}

/* Shift+Step 16: advance the watched clip's quantization to the next candidate
 * (0 / set default / 100) and show the panel. One gesture key for the whole
 * audition, so pressing through 0 -> 70 -> 100 is a single undo back to where
 * you started rather than three; the panel is the feedback, so no toast. */
function cycleQuantize(): void {
    const track = watchedTrack();
    const next = nextQuantCandidate(seqState.clipQuant, seqState.defaultQuant);
    beginGesture('quant:' + track, 'CLIP QUANT', trackLabel(track));
    seqState.clipQuant = next;
    seqCmd('cq ' + track + ' ' + next);
    armQuantOverlay(Date.now());
}
