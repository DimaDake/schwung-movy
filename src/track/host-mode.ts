/* Moving tracks 1-4 between schwung's shadow slots and movy's own chains.
 *
 * `chtracks` decides which host movy ADDRESSES for those four tracks. Nothing
 * migrates: schwung's slot keeps its module and simply stops being sent notes,
 * movy's chains 0-3 start empty, and flipping back finds the slot exactly as
 * it was. See plans/2026-08-24-movy-hosted-first-tracks.md for why not.
 *
 * **The order in `setMovyTracks` is the whole file.** A note-off is routed by
 * looking the track's port up at RELEASE time (`release.ts:emitNoteOff`), not by
 * remembering where the note-on went. Flip the flag first and every note still
 * down on tracks 1-4 gets its note-off delivered to the host that never played
 * it — ringing forever on the one that did, which no later gesture can reach.
 * So the release happens while the ports still resolve the old way, and the flag
 * moves after.
 */

import { HOST_TRACKS } from './ref.js';
import { resetPorts } from './registry.js';
import { resetPadRoute } from './pad-route.js';
import { releaseLiveOnTrack, releaseSequencerGates } from '../keyboard/release.js';
import { requestLabelSync } from '../seq/engine.js';
import { flagValue, setFlag } from '../seq/flags.js';
import { appState } from '../app/state.js';
import { buildTrackModels } from '../app/track-models.js';
import { mlog } from '../log.js';

/** True when tracks 1-4 are movy chains rather than schwung slots. */
export function movyOwnsFirstTracks(): boolean {
    return flagValue('chtracks') > 0;
}

/** Move tracks 1-4 to the other host. Safe to call with the value it already
 *  has — it returns without touching anything sounding. */
export function setMovyTracks(on: boolean): void {
    const next = on ? 1 : 0;
    if (flagValue('chtracks') === next) return;

    /* Old ports, old hosts. Live pad notes and the engine's own sequencer gates
     * both need closing, and only for the four tracks that are moving — the
     * twelve above them are not changing host and must keep sounding. */
    for (let t = 0; t < HOST_TRACKS; t++) releaseLiveOnTrack(t);
    const gates = releaseSequencerGates(0, HOST_TRACKS);

    setFlag('chtracks', next);

    /* `registry.ts` caches one port per track and the kind is baked into it, so
     * a stale cache would keep writing to the host we just left. */
    resetPorts();
    /* And the MODELS hold the port they were built with — re-pointing the
     * registry does not reach them. Without this the param pages go on reading
     * the old host until movy is restarted, which is what it looked like on
     * device: the flip appeared to do nothing. */
    for (let t = 0; t < HOST_TRACKS; t++) {
        appState.trackModels[t] = buildTrackModels(t);
    }
    /* The pad map carries the chain index. Forgetting it is what makes the next
     * tick push the new one — a comparison against the old value would find the
     * string unchanged for a track going back to `-1`. */
    resetPadRoute();
    /* Automation lanes on tracks 1-4 point at params on the host they were
     * mapped against; this re-applies the chain mappings and rebuilds the
     * registry. */
    requestLabelSync();
    appState.dirty = true;

    mlog('chtracks: tracks 1-4 -> ' + (next ? 'movy chains 0-3' : 'schwung slots')
        + ' (released ' + gates + ' gate(s))');
}
