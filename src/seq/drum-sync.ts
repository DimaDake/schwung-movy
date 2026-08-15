/* Mirrors each track's drum/melodic identity into the engine (`tdrum`).
 *
 * The engine sequences all four tracks but has no idea what module a chain slot
 * holds; only the UI does. It needs the answer because a drum module's pitches
 * are pad addresses, not notes — clip transpose must not shift them, or the
 * step plays a different voice (or none, when it lands off the pad range). */

import { portFor } from '../track/registry.js';
import { TRACK_COUNT } from '../track/ref.js';
import { appState, trackIsDrum } from '../app/state.js';
import { moduleReadKey } from '../chain/config.js';
import { loadModuleConfig } from '../modules/loader.js';
import { seqCmd } from './engine.js';
import { NAME_POLL_TICKS } from '../model/constants.js';

const NUM_TRACKS = 4;

/* Last value sent per track; -1 = unknown, so the first answer always sends. */
const sent = [-1, -1, -1, -1];
/* Tracks already answered by the direct probe below (see `probeTrack`). */
const probed = new Array(TRACK_COUNT).fill(false) as boolean[];
/* Ticks to wait before re-probing a track that gave no answer. An empty slot
 * never answers, so without this the probe repeats every tick for the life of
 * the tool — and each probe is a blocking round-trip the shim only services
 * once per SPI frame (~2.7 ms). Four empty tracks cost ~11 ms of every tick,
 * which is most of the tick period, and the tick period is also how often knob
 * MIDI is sampled. Retrying on the name-poll cadence keeps the "a module was
 * loaded from outside movy" case working at ~1 s granularity, for ~0.3% of the
 * IPC. */
const retryIn = [0, 0, 0, 0];

/* Drum identity for a track whose model hasn't loaded — only the *active*
 * track's model ticks, so an unvisited track would otherwise never report, and
 * the engine would transpose a drum clip it is already playing. Reads the same
 * two things loadHierarchy does (module id → module config), so the answer can't
 * drift from the model's. Runs at most once per track per tool open: an
 * unvisited track's module can only change from outside movy, and visiting it
 * hands authority back to the model. */
function probeTrack(t: number): number | null {
    const model = appState.trackModels[t]?.[1];
    if (!model || typeof shadow_get_param !== 'function') return null;
    const id = portFor(t).getParam( moduleReadKey(model.getComponentKey()));
    if (!id) return null;   // empty slot — leave it unanswered, not "melodic"
    return (loadModuleConfig(id)?.drum?.padCount ?? 0) > 0 ? 1 : 0;
}

/* Cheap per-tick check: nothing is sent while the answer is unchanged. A track
 * with no answer at all is skipped rather than reported melodic — a transient
 * "not loaded" must not clear a drum flag mid-playback. */
export function drumSyncTick(): void {
    for (let t = 0; t < NUM_TRACKS; t++) {
        const model = appState.trackModels[t]?.[1];
        if (!model) continue;
        let drum: number | null;
        if (model.hasLoadedParams()) {
            drum = trackIsDrum(t) ? 1 : 0;   // the model is authoritative
            probed[t] = true;
        } else if (!probed[t]) {
            if (retryIn[t] > 0) { retryIn[t]--; continue; }
            drum = probeTrack(t);
            if (drum !== null) probed[t] = true;
            else retryIn[t] = NAME_POLL_TICKS;
        } else {
            continue;
        }
        if (drum === null || sent[t] === drum) continue;
        sent[t] = drum;
        seqCmd('tdrum ' + t + ' ' + drum);
    }
}

/* Forget what the engine was told — on tool open and after an engine reload,
 * where `track_drum` is back to its default (all melodic) and must be re-sent. */
export function resetDrumSync(): void {
    sent.fill(-1);
    probed.fill(false);
    retryIn.fill(0);
}
