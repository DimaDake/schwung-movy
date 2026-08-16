/* Which track is being edited, and which quartet the four track buttons and the
 * session clip grid address.
 *
 * These two always move together: selecting a track from the step-row selector
 * has to refocus the group, otherwise the track buttons keep addressing a
 * different quartet than the one on screen. */

import { appState } from '../app/state.js';
import { GROUP_SIZE, TRACK_COUNT, trackGroup, trackRef } from './ref.js';

export function selectTrack(index: number): void {
    if (index < 0 || index >= TRACK_COUNT) return;
    appState.activeTrack = trackRef(index);
    appState.focusGroup  = trackGroup(index);
}

/** Track addressed by track button `n` (0-3) within the focused group. */
export function focusedTrack(n: number): number {
    return appState.focusGroup * GROUP_SIZE + n;
}

/* Which way the octave buttons scroll the Session grid. The grid is read as a
 * list of tracks running down the screen, so "up" walks towards track 1 and
 * "down" towards track 16 — the button follows the direction the eye moves,
 * not the direction the group index counts. Both the router and the LEDs take
 * their direction from here so the two can never disagree. */
export const GROUP_DIR_UP   = -1;
export const GROUP_DIR_DOWN = +1;

/** Move the focus group without changing which track is active. Used by the
 *  octave buttons in Session view, where the user is browsing groups rather
 *  than committing to a track. */
export function focusGroupStep(dir: number): boolean {
    const g = appState.focusGroup + dir;
    if (g < 0 || g * GROUP_SIZE >= TRACK_COUNT) return false;
    appState.focusGroup = g;
    return true;
}

/** First track of the group `dir` steps away, or -1 when there is none. */
export function groupStep(dir: number): number {
    const g = appState.focusGroup + dir;
    if (g < 0 || g * GROUP_SIZE >= TRACK_COUNT) return -1;
    return g * GROUP_SIZE;
}
