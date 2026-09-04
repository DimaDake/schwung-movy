/* Telling the UI's caches that the Set underneath them changed.
 *
 * A `Model` holds its module name and its whole param hierarchy and re-reads
 * them on the name poll — `NAME_POLL_TICKS`, which is ~1 s and, at the device's
 * measured 63-205 Hz, up to 5.5 s. That cadence is deliberate: movy's tick
 * period IS its MIDI sampling interval, so a faster poll is paid for in pad
 * latency. It is the right cadence for a module changing under a live surface.
 *
 * It is the wrong one for a Set load, where every model is stale at once and
 * the frame after the splash is the first the user sees. Nothing used to kick
 * it, so that frame was drawn from a cache older than the Set: an empty slot on
 * a cold open, the previous Set's module after a switch. */

import { appState } from './state.js';
import { seqState } from '../seq/state.js';
import type { Model } from '../model/index.js';

/** The model app/tick.ts is about to draw — the only one whose staleness the
 *  user can see this frame. Mirrors the choice the render makes. */
function shownModel(): Model | null {
    if (seqState.sessionMode)
        return appState.masterFxModels[appState.masterChainIndex] ?? null;
    const t = appState.activeTrack.index;
    return appState.trackModels[t]?.[appState.trackChainIndex[t]] ?? null;
}

/** Point every model at the Set that just loaded.
 *
 *  The one on screen is re-read HERE, synchronously, so the next frame is
 *  already truthful — that is the whole point, and it is one module's worth of
 *  reads, once per Set load. The rest are only SCHEDULED: re-reading eighty
 *  models on the audio-adjacent tick would cost far more than it buys, and each
 *  one re-reads on its first tick anyway, which is the tick it becomes visible.
 *
 *  Safe before any model exists — the session runs without a UI under test. */
export function refreshModelsForSet(): void {
    for (const chain of appState.trackModels) for (const m of chain ?? []) m?.reload();
    for (const m of appState.masterFxModels) m?.reload();
    shownModel()?.reloadNow();
    appState.dirty = true;
}
