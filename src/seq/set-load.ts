/* Loading a Set into the live engine: one pass, no decisions.
 *
 * WHETHER to load is set-session's call — this module only knows HOW. Keeping
 * the two apart is what stops "load" from quietly reacquiring the policy that
 * used to let a blank Set land on top of a live pattern. */

import { requestLabelSync } from './engine.js';
import { flagValue } from './flags.js';
import { findInheritCandidates } from './set-inherit.js';
import { SETS_DIR, loadNameIndex } from './set-context.js';
import { mlog } from '../log.js';
import { noteRestore } from './restore-gate.js';
import { readBestState, readUiBlob } from './persist-store.js';
import { resolveState } from './set-inherit.js';
import { applyUiState } from './ui-state.js';

/** Does this Set already own state? The rename-vs-switch question. */
export function setHasState(id: string): boolean {
    return readBestState(id) !== null;
}

/* Blocking on purpose: the engine must be holding the Set before any input is
 * accepted, and this runs once per Set rather than per tick.
 *
 * And CHECKED, which it was not. The write goes into the overtake_dsp param
 * SHM — a single slot with four producers — where a write can simply be lost
 * (`CLAUDE.md`: "routinely lost"). Discarding the boolean meant a Set that
 * never reached the engine looked exactly like a Set that had: the next
 * autosave then read the engine's blank state and wrote it over the real one.
 * Reproduced: au=1 cl=2 size=670 on disk became "movy1\n".
 *
 * Retried, because one loss says nothing about the next attempt — the same
 * reasoning the device fixture uses for module loads. */
export function pushState(payload: string): boolean {
    let ok = false;
    if (typeof host_module_set_param_blocking === 'function') {
        for (let i = 0; i < 3 && !ok; i++) {
            ok = host_module_set_param_blocking('state', payload, 200);
            if (!ok) mlog('seq: state push attempt ' + (i + 1) + ' did not land');
        }
        if (!ok) mlog('seq: RESTORE FAILED — the engine never took this Set');
    } else {
        /* No blocking API to ask. Older hosts never reported either way, so
         * assume it landed rather than blocking every save on this device. */
        ok = true;
    }
    noteRestore(ok);
    /* The restore carries the lane labels and assignments with it, so the
     * automation registry has to be rebuilt from them — without this it stays
     * empty: no dot, no held value, no read-back suppression. */
    requestLabelSync();
    return ok;
}


/* The Set the engine says it has open, or null when it has not answered.
 *
 * `null` means UNKNOWN and must never be read as "not this Set": the caller
 * re-sends, and re-sending an open costs nothing because it is idempotent. The
 * same push-by-comparison `syncWatch` uses for the watched track.
 */
export function setStatusUuid(): string | null {
    if (typeof host_module_get_param !== 'function') return null;
    const s = host_module_get_param('set');
    if (s === null) return null;
    const m = s.match(/(?:^| )uuid=(\S*)/);
    return m ? m[1] : null;
}

/* Open a Set by NAME rather than by value: the engine reads its own files, so
 * nothing about the Set crosses the param slot.
 *
 * `seed` carries copy-on-inherit. Which Set may seed this one is name policy
 * (`set-inherit.ts` — a regex over the name index, filtered by what still has
 * a state file and a live Move Set), so it stays here; only the byte copy is
 * the engine's. The engine ignores the seed when the Set owns state already. */
export function openSet(id: string, seed: string | null): void {
    if (typeof host_module_set_param_blocking !== 'function') return;
    /* Re-stated on every open rather than once per session: a re-dlopen'd
     * engine comes up knowing nothing, and an engine with no sets directory
     * answers `phase=failed reason=no-setsdir` forever. One extra param write
     * per Set load buys a path that heals itself. */
    host_module_set_param_blocking('setsdir', SETS_DIR, 200);
    const cmd = 'open ' + id + (seed ? ' seed=' + seed : '');
    host_module_set_param_blocking('set', cmd, 200);
    /* The restore carries the lane labels with it either way, so the automation
     * registry still has to be rebuilt from them. */
    requestLabelSync();
}

/** The Set that would seed `name` if it had no state of its own, or null. */
export function seedFor(name: string): string | null {
    const c = findInheritCandidates(name, loadNameIndex());
    return c.length > 0 ? c[0].uuid : null;
}

/** Read a Set's state, push it into the engine, and apply its UI blob if it has
 *  one. The caller decides what to do when it does not. */
export function loadSet(id: string, name: string): { payload: string; gen: number; ok: boolean } {
    /* Engine-owned: name the Set and let it read its own files. No payload is
     * read here and none is pushed, so there is nothing for the param slot to
     * lose — and the UI blob still applies, because its half is still the
     * UI's (the chains inside it are a mirror, ui-state.ts). */
    if (flagValue('engpersist')) {
        openSet(id, seedFor(name));
        const ui = readUiBlob(id);
        if (ui && ui.length > 0) applyUiState(ui);
        return { payload: '', gen: 0, ok: true };
    }
    const st = resolveState(id, name);
    const ok = pushState(st.payload);
    const ui = readUiBlob(id);
    if (ui && ui.length > 0) applyUiState(ui);
    return { ...st, ok };
}
