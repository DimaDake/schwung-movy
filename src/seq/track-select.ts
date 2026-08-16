/* Session view turns the 16 step buttons into a track selector.
 *
 * The focused group's four steps burn at full track colour and the other twelve
 * sit at their own DIMMER colour — a darker tier than `dim`, because this is the
 * only view that puts twelve of them on screen at once and the quad has to win.
 * The group is read from WHERE the bright quad is — position, not hue. That
 * matters because the sixteen colours have to be told apart by someone with a
 * red-green deficiency too, and position is the cue that never fails. */

import { appState } from '../app/state.js';
import { TRACK_COUNT, trackGroup } from '../track/ref.js';
import { selectTrack } from '../track/focus.js';
import { C_BLACK, trackColor, trackColorDimmer } from './colors.js';

export function sessionStepColor(step: number, focusGroup: number): number {
    if (step < 0 || step >= TRACK_COUNT) return C_BLACK;
    return trackGroup(step) === focusGroup ? trackColor(step) : trackColorDimmer(step);
}

export function sessionStepPress(step: number): void {
    if (step < 0 || step >= TRACK_COUNT) return;
    selectTrack(step);
    /* The clip grid rows follow the focused group, so the whole pad surface
     * repaints — not just the step row. */
    appState.initLedsDone = false;
    appState.initLedIndex = 0;
    appState.dirty = true;
}
