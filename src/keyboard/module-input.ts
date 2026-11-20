/* Input a module can claim on its own track (keyboard/module-feedback.ts
 * documents the keys): the 16 step buttons, Loop + knob, captured knobs and Undo. The glue between
 * the pure key helpers and the active track's port. A module that declares
 * nothing is never touched: every function here answers false for it. */

import { appState } from '../app/state.js';
import { portFor } from '../track/registry.js';
import {
    feedbackCapture, knobDeltaWrite, loopKnobWrite, stepPressWrite, undoWrite, type FeedbackKeys,
} from './module-feedback.js';

function active(): { keys: FeedbackKeys; track: number; comp: string } | null {
    const track = appState.activeTrack.index;
    const model = appState.trackModels[track]?.[1];
    const keys = model?.getFeedbackKeys() ?? null;
    if (!model || !keys) return null;
    return { keys, track, comp: model.getComponentKey() };
}

/** The active track's module owns the step row (and so the Loop button). */
export function moduleOwnsStepRow(): boolean {
    return !!active()?.keys.stepKey;
}

/** The active track's module takes Loop + knob. */
export function moduleOwnsLoopKnobs(): boolean {
    return !!active()?.keys.loopKnobKey;
}

/** A step button event. Presses write the index to the module; the release is
 *  swallowed too. False = not the module's, run the sequencer as before. */
export function moduleStepButton(button: number, on: boolean): boolean {
    const a = active();
    if (!a || !a.keys.stepKey) return false;
    if (on) {
        const w = stepPressWrite(a.keys, button);
        if (w) portFor(a.track).setParam(a.comp + ':' + w[0], w[1]);
        appState.dirty = true;
    }
    return true;
}

/** A knob turn while Loop is held. True = consumed by the module. */
export function moduleLoopKnob(knob: number, delta: number, fine: boolean): boolean {
    const a = active();
    if (!a) return false;
    const w = loopKnobWrite(a.keys, knob, delta, fine);
    if (!w) return false;
    portFor(a.track).setParam(a.comp + ':' + w[0], w[1]);
    appState.dirty = true;
    return true;
}

/** The active track's module has taken the knobs (knob_capture_param reads 1). */
export function moduleKnobsCaptured(): boolean {
    const a = active();
    return !!a && !!a.keys.captureKey && !!a.keys.knobDeltaKey && feedbackCapture(a.track);
}

/** A knob turn the module owns: Loop held -> loop_knob, else captured -> knob_delta.
 *  True = consumed. `loop` = Move's Loop button is held. */
export function moduleKnobTurn(knob: number, delta: number, fine: boolean, loop: boolean): boolean {
    if (loop && moduleLoopKnob(knob, delta, fine)) return true;
    const a = active();
    if (!a || !moduleKnobsCaptured()) return false;
    const w = knobDeltaWrite(a.keys, knob, delta, fine);
    if (!w) return false;
    portFor(a.track).setParam(a.comp + ':' + w[0], w[1]);
    appState.dirty = true;
    return true;
}

/** The active track's module takes Undo / Shift+Undo (undo_param). */
export function moduleOwnsUndo(): boolean {
    return !!active()?.keys.undoKey;
}

/** Undo (or redo) goes to the module. False = not the module's, movy undoes. */
export function moduleUndo(redo: boolean): boolean {
    const a = active();
    if (!a) return false;
    const w = undoWrite(a.keys, redo);
    if (!w) return false;
    portFor(a.track).setParam(a.comp + ':' + w[0], w[1]);
    appState.dirty = true;
    return true;
}
