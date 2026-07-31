import { releaseAllLive, emitNoteOff } from '../keyboard/release.js';
import { seqState } from '../seq/state.js';
import { seqPersistFlush } from '../seq/persist.js';
import { mlog } from '../log.js';

/* Called by the host on every teardown path — Close Movy, Shift+Back instant
 * exit, and parked-module eviction — immediately before the overtake DSP is
 * unloaded (schwung's invokeModuleOnUnload). Everything sounding has to be
 * released here: once the DSP is gone the sequencer can no longer close its own
 * gates, so its notes would ring in the chain indefinitely.
 *
 * The engine need not still be responsive: seqState.activeNotes mirrors its open
 * gates from the `act=` status field, so the UI can close them on its own. That
 * mirror is a poll snapshot, so a gate opened since the last poll is missed;
 * the host's CC 123 sweep fires right after this call and covers the residue.
 * We do not depend on that sweep for anything we can account for ourselves. */
export function onUnload(): void {
    releaseAllLive();
    let gates = 0;
    for (let t = 0; t < 4; t++) {
        const base = t * 128;
        for (let p = 0; p < 128; p++) {
            if (seqState.activeNotes[base + p] === 1) {
                emitNoteOff(t, p);
                gates++;
            }
        }
    }
    mlog('unload: released ' + gates + ' sequencer note(s)');

    /* Last chance to persist: the autosave only runs every ~3 s, so without
     * this every exit dropped whatever was done since the last one. Notes are
     * released first — a stuck note outlives the tool, so it must not wait
     * behind file I/O. The engine is still loaded here (schwung unloads the DSP
     * immediately after this returns), so it can still serialize its state. */
    seqPersistFlush(true);
}
