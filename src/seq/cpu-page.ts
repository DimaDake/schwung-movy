/* CPU meter page: what each track's chain costs per audio block, over a
 * capacity bar for the whole chain render. Opened with Shift+Step 12, closed
 * with Back.
 *
 * The page has no gesture state and no editable value — every number on it
 * comes from the engine, and there is nothing to turn. What it does own is the
 * PEAK: `cpurst` clears the engine's held maxima, so opening the page starts a
 * fresh observation, and pressing the gesture again while it is up clears them
 * without leaving — the button a hardware meter puts its peak-reset on.
 *
 * Sibling of Set Params, Clip Params and Settings in the param-page.ts layer,
 * so one Back leaves all four and a track button closes them. Being open IS
 * `currentView === VIEW_CPU` — see the note in main-page.ts for what a second
 * hand-synced copy of that fact costs. */

import { appState, VIEW_CPU } from '../app/state.js';
import { openParamPage } from './param-page.js';
import { seqCmd } from './engine.js';

export function cpuPageActive(): boolean {
    return appState.currentView === VIEW_CPU;
}

/** Open the page, or — if it is already up — restart the peak observation. */
export function openCpuPage(): void {
    openParamPage(VIEW_CPU);
    seqCmd('cpurst');
}

/** Nothing transient to drop. Present so `param-page.ts` treats all four
 *  siblings the same way, rather than special-casing the one without state. */
export function clearCpuPage(): void {}
