/* Where the two AI gestures meet the sequencer state (design §2, §3): who may
 * start a job, on which clip, and when Step 14's hint lights. */

import { appState } from '../app/state.js';
import { seqToast } from '../seq/render.js';
import { sessionReady } from '../seq/set-session.js';
import { seqState } from '../seq/state.js';
import { watchedTrack } from '../seq/watch.js';
import { STEP_AI_VARIATION, STEP_QUANTIZE } from '../seq/constants.js';
import { type HoldKind, holdKind, holdPending, holdPress, holdTick } from './hold.js';
import { MSG_NOTHING, startAiJob } from './job.js';

/* A Set still loading or settling would be read half-restored. */
function busy(): boolean {
    return !sessionReady() || seqState.recording || seqState.countingIn || seqState.sessionMode;
}

/** Whether a Shift + Step 16 press may grow into Smart Quantize. */
export function aiHoldAllowed(): boolean { return !busy(); }

/** The generator a Shift + hold on this step button grows into. */
export function holdStep(button: number): HoldKind | null {
    return button === STEP_QUANTIZE ? 'quantize' : button === STEP_AI_VARIATION ? 'variation' : null;
}

/** A pending hold started on this button, so its release is the hold's. */
export function holdOwns(button: number): boolean { return holdPending() && holdKind() === holdStep(button); }

export const MSG_HOLD = 'HOLD TO GENERATE';

/** A Shift tap on Step 14: nothing starts, but say how it would. */
export function aiVariationTap(): void { if (aiVariationAllowed()) seqToast(MSG_HOLD); }

/** Whether a Shift + Step 14 press may grow into a Variation. */
export function aiVariationAllowed(): boolean { return !busy() && variationPossible(); }

function selectedSlot(t: number): number { return seqState.session[t]?.selected ?? 0; }

/** A variation needs another clip on the track to grow from. */
export function variationPossible(): boolean {
    const t = watchedTrack();
    const s = seqState.session[t];
    return !!s && (s.exist & ~(1 << s.selected)) !== 0;
}

export function aiQuantizeStart(): void {
    if (busy()) return;
    if (seqState.lenSteps <= 0 || !seqState.occ.some((b) => b !== 0)) { seqToast(MSG_NOTHING); return; }
    const t = watchedTrack();
    startAiJob('quantize', t, selectedSlot(t));
}

/** A full Shift + Step 14 hold. Track view only: Session view's row selects tracks. */
export function aiVariationStart(): void {
    if (busy() || !variationPossible()) return;
    const t = watchedTrack();
    startAiJob('variation', t, selectedSlot(t));
}

/** Shift + press on Step 16 or 14: arm a hold only when it could start. */
export function aiHoldPress(k: HoldKind): void {
    holdPress(Date.now(), k, k === 'quantize' ? aiHoldAllowed() : aiVariationAllowed());
}

/** Per tick: completes a Shift + Step 16 or Step 14 hold. */
export function aiGestureTick(now: number): void {
    holdTick(now, appState.shiftHeld, (k) => (k === 'quantize' ? aiQuantizeStart() : aiVariationStart()));
}
