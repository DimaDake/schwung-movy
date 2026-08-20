/* Navigation for the two global parameter pages — Set Params (main-page.ts)
 * and Clip Params (clip-page.ts).
 *
 * They are SIBLINGS at one level of hierarchy, not a stack: opening either one
 * from the other replaces it, and Back leaves the layer entirely for the view
 * it was entered from. That is why the origin lives here, once, instead of one
 * copy per page. Each page used to capture `appState.currentView` as its own
 * origin — and `currentView` can be the sibling page, so after opening the two
 * in turn their origins pointed at each other: Back cycled between them
 * forever, and every "close the param page" site (a track button, Session)
 * landed on the sibling instead of on a real view. A track switch then stored
 * that param page in `appState.trackView[]`, which is how a global page ended
 * up remembered per track.
 *
 * Owning the view switch here is also what keeps "is the page open" and "is it
 * on screen" the same fact: being open IS `currentView`, so no path can move
 * the view and leave a page latched (see the note in main-page.ts). */

import { appState, VIEW_CHAIN, VIEW_MAIN_PARAMS, VIEW_CLIP_PARAMS } from '../app/state.js';
import { clearMainPage } from './main-page.js';
import { clearClipPage } from './clip-page.js';

export const paramPageState = {
    origin: VIEW_CHAIN as number,   // view to restore when the layer is left
};

/** True while either param page is on screen. */
export function paramPageActive(): boolean {
    return appState.currentView === VIEW_MAIN_PARAMS
        || appState.currentView === VIEW_CLIP_PARAMS;
}

/** Show `view` (VIEW_MAIN_PARAMS or VIEW_CLIP_PARAMS). Re-pressing the gesture
 *  for the page already up is a no-op, so it cannot reset a knob mid-turn. */
export function openParamPage(view: number): void {
    if (appState.currentView === view) return;
    // Only the FIRST entry records an origin; opening the sibling replaces the
    // page without deepening the hierarchy.
    if (!paramPageActive()) paramPageState.origin = appState.currentView;
    clearMainPage();
    clearClipPage();
    appState.currentView = view;
}

/** Leave the layer; returns the origin view, which it has already restored. */
export function closeParamPage(): number {
    clearMainPage();
    clearClipPage();
    appState.currentView = paramPageState.origin;
    return paramPageState.origin;
}

export function resetParamPage(): void {
    paramPageState.origin = VIEW_CHAIN;
}
