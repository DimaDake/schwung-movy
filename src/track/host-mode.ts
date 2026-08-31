/* Moving tracks 1-4 between schwung's shadow slots and movy's own chains.
 *
 * `chtracks` decides which host movy ADDRESSES for those four tracks: SCHWUNG or
 * MOVY everywhere, or NEW SETS — defer to a value the SET carries, so work built
 * on schwung slots keeps them while anything new starts on the faster chains.
 * Nothing
 * migrates: schwung's slot keeps its module and simply stops being sent notes,
 * movy's chains 0-3 start empty, and flipping back finds the slot exactly as
 * it was. See plans/2026-08-24-movy-hosted-first-tracks.md for why not.
 *
 * **The order in `withHostFlip` is the whole file.** A note-off is routed by
 * looking the track's port up at RELEASE time (`release.ts:emitNoteOff`), not by
 * remembering where the note-on went. Flip the flag first and every note still
 * down on tracks 1-4 gets its note-off delivered to the host that never played
 * it — ringing forever on the one that did, which no later gesture can reach.
 * So the release happens while the ports still resolve the old way, and the flag
 * moves after.
 */

import { HOST_TRACKS, movyTracksOn } from './ref.js';
import { resetPorts } from './registry.js';
import { resetPadRoute } from './pad-route.js';
import { releaseLiveOnTrack, releaseSequencerGates } from '../keyboard/release.js';
import { requestLabelSync } from '../seq/engine.js';
import { flagValue, setFlag, loadPerSetFlags, perSetFlagsFrom, pushFlagToEngine } from '../seq/flags.js';
import { HOST_MOVY, HOST_SCHWUNG, resolveHost } from '../seq/flags-def.js';
import { appState } from '../app/state.js';
import { buildTrackModels } from '../app/track-models.js';
import { mlog } from '../log.js';

/** True when tracks 1-4 are movy chains rather than schwung slots. */
export function movyOwnsFirstTracks(): boolean {
    return movyTracksOn();
}

/** Everything that reads a track's host through a cache, dropped in one place.
 *  Called only when the resolved host actually moved. */
function repointTracks(): void {
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
    /* `drain_out` routes a sequenced note out as MIDI or into a chain, so the
     * engine has to learn the new host too. The value that moved may have been
     * the SET's, which is `uiOnly` — its effect still travels under `chtracks`. */
    pushFlagToEngine('chtracks');
    /* Automation lanes on tracks 1-4 point at params on the host they were
     * mapped against; this re-applies the chain mappings and rebuilds the
     * registry. */
    requestLabelSync();
    appState.dirty = true;
}

/** Change something that decides the host of tracks 1-4, in the one order that
 *  is safe. `next` is what the host WILL be once `mutate` has run, computed
 *  before it: a note-off is routed by looking the track's port up at RELEASE
 *  time (`release.ts:emitNoteOff`), not by remembering where the note-on went.
 *  Mutating first would deliver every note-off still down on tracks 1-4 to the
 *  host that never played it — ringing forever on the one that did, which no
 *  later gesture can reach. */
function withHostFlip(next: boolean, mutate: () => void): void {
    const moved = next !== movyTracksOn();
    let gates = 0;
    if (moved) {
        /* Old ports, old hosts. Live pad notes and the engine's own sequencer
         * gates both need closing, and only for the four tracks that are moving
         * — the twelve above them are not changing host and must keep sounding. */
        for (let t = 0; t < HOST_TRACKS; t++) releaseLiveOnTrack(t);
        gates = releaseSequencerGates(0, HOST_TRACKS);
    }
    mutate();
    if (!moved) return;
    repointTracks();
    mlog('chtracks: tracks 1-4 -> ' + (next ? 'movy chains 0-3' : 'schwung slots')
        + ' (released ' + gates + ' gate(s))');
}

/** The page's edit of the global mode (SCHWUNG / MOVY / NEW SETS). */
export function setHostMode(mode: number): void {
    withHostFlip(resolveHost(mode, flagValue('chtrackset')),
                 () => setFlag('chtracks', mode));
}

/** The page's edit of the CURRENT SET's value, which only the NEW SETS mode
 *  consults. Stored in the set's own blob, so it travels with the set. */
export function setSetHost(v: number): void {
    withHostFlip(resolveHost(flagValue('chtracks'), v),
                 () => setFlag('chtrackset', v));
}

/** Adopt the incoming set's per-set flags, moving tracks 1-4 if that changes
 *  which host owns them. `o` is the `flags` object out of the set's ui-state
 *  blob, or null for a Set movy has never seen. */
export function loadSetHostChoice(o: Record<string, unknown> | null): void {
    const incoming = perSetFlagsFrom(o)['chtrackset'];
    withHostFlip(resolveHost(flagValue('chtracks'), incoming),
                 () => loadPerSetFlags(o));
}

/** Move tracks 1-4 to the other host, globally. Safe to call with the value it
 *  already has — it returns without touching anything sounding. */
export function setMovyTracks(on: boolean): void {
    setHostMode(on ? HOST_MOVY : HOST_SCHWUNG);
}
