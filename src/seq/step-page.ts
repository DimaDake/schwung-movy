/* Step parameter page: shown only during a parameter-lock session (a held
 * step). It is page 0, ahead of the module banks / chain slots. Selection is
 * remembered across sessions so a session that ended on the step page reopens
 * there next time (the page does not exist outside a session, so a flag carries
 * that intent). Knob/value editing lives in step-edit.ts; rendering reads this. */

import { seqState, occHasStep } from './state.js';

export const stepPageState = {
    /** The step page (page 0) is the currently selected page this session. */
    selected: false,
    /** Carried across sessions: the prior session ended on the step page. */
    lastSessionStepPage: false,
    /** Step-page knob (0..4) currently touched/turned → drives the top toast. -1 = none. */
    touchedKnob: -1,
};

export function setStepTouchedKnob(k: number): void { stepPageState.touchedKnob = k; }

/** Session (parameter lock) begins: open the step page iff the last one did. */
export function onSessionStart(): void {
    stepPageState.selected = stepPageState.lastSessionStepPage;
}

/** Session ends: remember whether the step page was open. */
export function onSessionEnd(): void {
    stepPageState.lastSessionStepPage = stepPageState.selected;
    stepPageState.selected = false;
}

export function setStepPageSelected(v: boolean): void {
    stepPageState.selected = v;
}

/** True when the step page should be rendered/edited (session active + selected). */
export function stepPageActive(sessionActive: boolean): boolean {
    return sessionActive && stepPageState.selected;
}

/* The step page only exists for a held step that actually HAS a note on the
 * watched lane — there are no per-trig params to edit on an empty step (occ is
 * already lane-filtered by the engine). Empty held steps fall back to the normal
 * module page so chain-automation (hold-step) editing still works there. */
export function stepPageAvailable(): boolean {
    return seqState.stepAutoMode && occHasStep(seqState.holdStep);
}

export function resetStepPage(): void {
    stepPageState.selected = false;
    stepPageState.lastSessionStepPage = false;
    stepPageState.touchedKnob = -1;
}
