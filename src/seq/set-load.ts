/* Loading a Set into the live engine: one pass, no decisions.
 *
 * WHETHER to load is set-session's call — this module only knows HOW. Keeping
 * the two apart is what stops "load" from quietly reacquiring the policy that
 * used to let a blank Set land on top of a live pattern. */

import { aiSetWillChange } from '../ai/job.js';
import { requestLabelSync } from './engine.js';
import { setsDir } from './set-source.js';
import { paramGet, paramSet } from '../host/param.js';
import { readChainsFile, readUiBlob } from './persist-store.js';
import { parseChainsFile } from '../track/chains-file.js';
import { restoreChains } from '../track/chain-persist.js';
import { mlog } from '../log.js';
import { applyUiState } from './ui-state.js';

/* The Set the engine says it has open, or null when it has not answered.
 *
 * `null` means UNKNOWN and must never be read as "not this Set": the caller
 * re-sends, and re-sending an open costs nothing because it is idempotent. The
 * same push-by-comparison `syncWatch` uses for the watched track.
 */
export function setStatusUuid(): string | null {
    const s = paramGet('set');
    if (s === null) return null;
    const m = s.match(/(?:^| )uuid=(\S*)/);
    return m ? m[1] : null;
}

/* Open a Set by NAME rather than by value: the engine reads its own files, so
 * nothing about the Set crosses the param slot. */
export function openSet(id: string): void {
    aiSetWillChange();   // an AI request or preview must not span two Sets
    /* Re-stated on every open rather than once per session: a re-dlopen'd
     * engine comes up knowing nothing, and an engine with no sets directory
     * answers `phase=failed reason=no-setsdir` forever. One extra param write
     * per Set load buys a path that heals itself. */
    paramSet('setsdir', setsDir());
    paramSet('set', 'open ' + id);
    /* The Set carries its lane labels and assignments, so the automation
     * registry has to be rebuilt from them — without this it stays empty: no
     * dot, no held value, no read-back suppression. */
    requestLabelSync();
}


/* The Set's chains, from chains.json. Ahead of anything cosmetic: the loads
 * are queued one per audio callback, so the sooner they start the sooner the
 * Set sounds like itself. One document says both what to unload and what to
 * load, so a Set with no chains still clears the previous Set's.
 *
 * An unreadable file restores none, rather than leaving the previous Set's
 * instruments in place to be saved under this one. Its bytes are not lost: the
 * engine's open captured them in the version it took before reading. */
function restoreSetChains(id: string): void {
    const raw = readChainsFile(id);
    const saved = parseChainsFile(raw);
    if (raw !== null && !saved) mlog('chains: ' + id + ' has a chains.json that will not parse — opening with none (kept in BACKUPS)');
    const n = restoreChains(saved ? saved.chains : null, saved ? saved.sends : null);
    if (n > 0) mlog('chains: restoring ' + n + ' movy chain component(s)');
}

/** Open a Set in the engine, restore its chains and apply its UI blob if it
 *  has one. The caller decides what to do when it does not. */
export function loadSet(id: string): void {
    /* The engine reads its own files: no payload is read here and none is
     * pushed, so there is nothing for the param slot to lose. */
    openSet(id);
    restoreSetChains(id);
    const ui = readUiBlob(id);
    if (ui && ui.length > 0) applyUiState(ui);
}
