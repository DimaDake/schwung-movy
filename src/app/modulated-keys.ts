/* modulated-keys.ts — which model answers "is this key modulated", for a page
 * that belongs to a (track, component) rather than to a model.
 *
 * The delegated page is created by `renderer/schwung-grid` from a track index
 * and a component key; the LFO routing that decides the answer lives on the
 * MODEL, which is app state (R12: renderer/ must not grow app state). So the
 * page is handed a FUNCTION.
 *
 * IT IS A FUNCTION, NOT THE SET IT RETURNS. A page is cached by (track,
 * component) and outlives the chain slot that built it, so a captured Set would
 * go on answering with the modulation of whichever module happened to be loaded
 * first — and would go on being believed, because a tilde that is merely stale
 * is not a failure of anything visible.
 */

import { appState } from './state.js';

/**
 * The params a slot LFO drives on `componentKey`'s model in `track`, or null
 * when no model there owns that component.
 *
 * The same resolution `app/tick.ts` does for its own module lookups, and the
 * same set the `~` mark on movy's own page is drawn from (`model/viewmodel.ts`)
 * — one source, so the two marks cannot disagree.
 */
export function modulatedKeysOf(track: number, componentKey: string): ReadonlySet<string> | null {
    const chain = appState.trackModels[track];
    if (!chain) return null;
    for (const m of chain) {
        /* Guarded member by member: this walks models of every kind — a module,
         * a scoped LFO, the mix page — and the app tick hands `pageOwnerOf`
         * stubs as well as real models. */
        if (!m || typeof m.getComponentKey !== 'function') continue;
        if (m.getComponentKey() !== componentKey) continue;
        return typeof m.modulatedKeys === 'function' ? m.modulatedKeys() : null;
    }
    return null;
}
