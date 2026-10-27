/* Where the two AI gestures meet the sequencer state (design §2, §3): who may
 * start a job, on which clip, and when Step 14's hint lights. */

import { appState } from '../app/state.js';
import { seqToast } from '../seq/render.js';
import { seqState } from '../seq/state.js';
import { watchedTrack } from '../seq/watch.js';
import { hold16Tick } from './hold16.js';
import { MSG_NOTHING, startAiJob } from './job.js';

function busy(): boolean { return seqState.recording || seqState.countingIn || seqState.sessionMode; }

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

/** Shift + Step 14. Track view only: Session view's row selects tracks. */
export function aiVariationPress(): void {
    if (busy() || !variationPossible()) return;
    const t = watchedTrack();
    startAiJob('variation', t, selectedSlot(t));
}

/** Per tick: completes a Shift + Step 16 hold. */
export function aiGestureTick(now: number): void {
    hold16Tick(now, appState.shiftHeld, aiQuantizeStart);
}
