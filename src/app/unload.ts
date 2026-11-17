import { TRACK_COUNT } from '../track/ref.js';
import { releaseAllLive, releaseSequencerGates } from '../keyboard/release.js';
import { seqCmd, seqCmdFlush } from '../seq/engine.js';
import { resetSeqChord } from '../seq/router.js';
import { seqState } from '../seq/state.js';
import { sessionFlush } from '../seq/set-session.js';
import { mlog } from '../log.js';
import { paramSet } from '../host/param.js';
import { releasePadRoute } from '../track/pad-route.js';

/* Called by the host on every teardown path — Close Movy, power off, the
 * fallback exit — immediately before the engine is unloaded. Everything sounding has to be
 * released here: once the DSP is gone the sequencer can no longer close its own
 * gates, so its notes would ring in the chain indefinitely.
 *
 * The engine need not still be responsive: seqState.activeNotes mirrors its open
 * gates from the `act=` status field, so the UI can close them on its own. That
 * mirror is a poll snapshot, so a gate opened since the last poll is missed —
 * harmless here, since the engine is unloaded right after and takes its
 * chains with it. */
export function onUnload(): void {
    /* Before the ledger is drained: closing a held pad's recording capture
     * needs the track it was sounded on, and a note still down at teardown
     * would otherwise be dropped from the take rather than finalized. Only
     * queues — the note-offs below still go out first. */
    resetSeqChord(true);
    releaseAllLive();
    const gates = releaseSequencerGates(0, TRACK_COUNT);
    mlog('unload: released ' + gates + ' sequencer note(s)');
    /* What the engine holds itself, closed by the engine. The mirror above
     * skips the active track (its pads are the engine's), and a playing clip
     * can open a new gate before the engine goes; `halt` stops the sequencer
     * and closes every gate, without stopping a Link session. Taking the pads
     * back makes it close any pad still held (pad_route's drain_held). Both
     * matter beyond the chain, which goes with the engine: a MIDI Out module
     * puts these note-offs on USB-A, and an external synth has nothing else
     * to end its note. */
    seqCmd('halt');
    releasePadRoute(paramSet);

    /* There is no next tick to drain the queue, and the engine has to have
     * applied those note-offs before it serializes the state below. */
    seqCmdFlush();

    /* Last chance to persist: the autosave only runs every ~3 s, so without
     * this every exit dropped whatever was done since the last one. Notes are
     * released first — a stuck note outlives the tool, so it must not wait
     * behind file I/O. The engine is still loaded here (schwung unloads the DSP
     * immediately after this returns), so it can still serialize its state. */
    sessionFlush(true);
}
