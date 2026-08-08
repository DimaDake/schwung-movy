/* The transient panel Shift+Step 16 raises: the quantization candidates with
 * the new value boxed, plus the jog as an optional refinement while it is up.
 *
 * It is a confirmation, not a decision — unlike the capture overlay, which
 * blocks with no default and owns the screen. So it sits over the current view
 * and lets anything that neither repaints nor toasts run underneath it. */

import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { appState } from '../app/state.js';
import { quantCandidates, candidateIndex } from './quant.js';
import { endEdit } from '../undo/group.js';
import {
    CC_MUTE, MAIN_PAGE_STEPS, STEP_CLIP_PARAMS, STEP_METRO, STEP_FULL_VEL,
    STEP_NOTE_BASE, STEP_QUANTIZE,
} from './constants.js';

/* Wall-clock, not ticks. The device tick rate swings 63-205 Hz with load, so a
 * tick-counted lifetime would be 0.96 s on a busy device and 3.1 s on an idle
 * one (the existing toast lives with exactly that). 1200 ms is above the
 * ~700-800 ms it takes to find the box among three values, with margin for a
 * late glance, and short enough never to feel in the way. */
const LIFETIME_MS = 1200;

const JOG_TOUCH = 9;

/* Inputs that repaint the screen or raise a toast, so leaving the panel up
 * behind them would collide. Everything else the sequencer router handles is
 * LED-only and may run underneath — which is why pads, steps, bar navigation
 * and TRANSPORT are absent here and never get eaten. Keep this in step with
 * the `appState.dirty` / `seqToast` sites in router.ts. */
const DISMISSING_CCS: number[] = [CC_MUTE];
const DISMISSING_SHIFT_STEPS: number[] = [
    STEP_CLIP_PARAMS, STEP_METRO, STEP_FULL_VEL,
    ...Object.keys(MAIN_PAGE_STEPS).map(Number),
];

export type QuantOverlayAction = 'jog' | 'swallow' | 'dismiss' | 'through';

let untilMs = 0;

export function quantOverlayActive(): boolean { return untilMs > 0; }

export function armQuantOverlay(nowMs: number): void {
    untilMs = nowMs + LIFETIME_MS;
    appState.dirty = true;
}

/** Age the panel. Returns true on the call that expires it, so the caller can
 *  repaint the view underneath once. */
export function quantOverlayTickAt(nowMs: number): boolean {
    if (untilMs > 0 && nowMs >= untilMs) {
        dismissQuantOverlay();
        return true;
    }
    return false;
}

export function dismissQuantOverlay(): void {
    if (untilMs === 0) return;
    untilMs = 0;
    /* The audition ends here, so the gesture the shortcut opened closes here:
     * walking 0 -> 70 -> 100 is one undo back to where you started. */
    endEdit('quant:' + seqState.watchTrack);
    appState.dirty = true;
}

/** Jog while the panel is up: move the selection, commit, and re-arm. */
export function quantOverlayJog(delta: number, nowMs: number): void {
    if (untilMs === 0) return;
    /* Direction, not accumulated detents: every other jog consumer in movy
     * reads it as `delta > 0 ? 1 : -1` (chain nav, loop resize, the capture
     * picker). DETENT_DIV belongs to the eight param knobs, which are finer —
     * using it here would cost eight CC events per candidate. */
    const n = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    /* Re-arm even on a null turn — otherwise the panel dies under the user's
     * hand mid-dial. */
    untilMs = nowMs + LIFETIME_MS;
    if (n === 0) return;
    const cands = quantCandidates(seqState.defaultQuant);
    const cur = candidateIndex(seqState.clipQuant, seqState.defaultQuant);
    /* Off-cycle values start from the bottom rather than nowhere. Clamped, not
     * wrapping: with three candidates, wrapping would turn one click past
     * 100 % into 0 % — raw timing, from what felt like a small overshoot. */
    const next = Math.max(0, Math.min(cands.length - 1, (cur < 0 ? 0 : cur) + n));
    if (cands[next] !== seqState.clipQuant) {
        seqState.clipQuant = cands[next];
        seqCmd('cq ' + seqState.watchTrack + ' ' + cands[next]);
    }
    appState.dirty = true;
}

/** Re-arm without changing anything — a finger resting on the jog holds it. */
export function quantOverlayHold(nowMs: number): void {
    if (untilMs > 0) untilMs = nowMs + LIFETIME_MS;
}

export function resetQuantOverlay(): void {
    untilMs = 0;
}

/** How `data` should be treated while the panel is up. */
export function quantOverlayAction(data: number[], shiftHeld: boolean): QuantOverlayAction {
    const type = data[0] & 0xF0;
    /* Releases always fall through, so no handler is left holding a button
     * that never came up — and so Shift coming up ~100 ms after the gesture
     * does not kill the panel before it has been read. */
    if (data[2] === 0) return 'through';
    if (type === 0xB0 && data[1] === MoveMainKnob) return 'jog';
    if (type === 0x90 && data[1] === JOG_TOUCH) return 'swallow';
    /* The arming gesture itself advances the cycle instead of dismissing. */
    if (shiftHeld && type === 0x90
        && data[1] === STEP_NOTE_BASE + STEP_QUANTIZE) return 'through';
    if (shiftHeld && type === 0x90 && DISMISSING_SHIFT_STEPS
        .indexOf(data[1] - STEP_NOTE_BASE) >= 0) return 'dismiss';
    if (type === 0xB0 && (data[1] === MoveBack || data[1] === MoveMainButton)) return 'dismiss';
    if (type === 0xB0 && DISMISSING_CCS.indexOf(data[1]) >= 0) return 'dismiss';
    return 'through';
}

export interface QuantOverlayVM {
    /** Track the panel is editing — it names the clip in the title. */
    track: number;
    values: string[];
    selIdx: number;
    /** Index of the set default, or -1 when it coincides with an end. */
    defIdx: number;
}

export function buildQuantOverlayVM(): QuantOverlayVM {
    const cands = quantCandidates(seqState.defaultQuant);
    const d = Math.max(0, Math.min(100, Math.round(seqState.defaultQuant)));
    return {
        track: seqState.watchTrack,
        values: cands.map((v) => v + '%'),
        selIdx: candidateIndex(seqState.clipQuant, seqState.defaultQuant),
        defIdx: d === 0 || d === 100 ? -1 : cands.indexOf(d),
    };
}
