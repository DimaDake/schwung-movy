/* Which host a set USED to be on.
 *
 * The last remnant of `chtracks`/`chtrackset`. It reads the raw stored numbers
 * rather than going through `flags.ts`, because the flags themselves are gone —
 * what is left on disk is the only record of how a set was built, and it is the
 * only thing that says whether a set has instruments waiting in schwung's slots.
 *
 * DELETABLE once the fleet has turned over: every set that has ever been opened
 * by a build carrying this comes away with a `migv` marker, so this answer is
 * only ever needed once per set. Delete the file and every set is simply already
 * migrated. */

import { readPrefFlags } from '../seq/prefs.js';

/* The three values the deleted `chtracks` ordinal could take. */
const HOST_SCHWUNG = 0;
const HOST_MOVY = 1;
const HOST_NEW_SETS = 2;

/** True when tracks 1-4 of this set were schwung shadow slots — i.e. the set may
 *  have instruments that movy can no longer reach.
 *
 *  `o` is the `flags` object out of the set's ui-state blob, or null/undefined
 *  for a set with no blob at all. **A set with no blob answers TRUE**, even
 *  though the shipped default was MOVY: a set DUPLICATED in Move also arrives
 *  without one, and schwung has copied the original's slots into it. Trusting
 *  the default there strands the copy on a host that no longer exists. A
 *  genuinely new set answers true too, and simply finds nothing. */
export function legacySetWasSchwung(o: Record<string, unknown> | null | undefined): boolean {
    const mode = storedMode();
    if (mode === HOST_MOVY) return false;
    if (mode === HOST_SCHWUNG) return true;
    /* NEW SETS: the set's own value decides. Absent means a blob written before
     * the field existed, which kept the schwung slots it was built on — the old
     * flag def spelled that `legacy: 0`. */
    if (!o || typeof o['chtrackset'] !== 'number') return true;
    return (o['chtrackset'] as number) <= 0;
}

/** The stored global mode, defaulting to what shipped. */
function storedMode(): number {
    const v = readPrefFlags()['chtracks'];
    return typeof v === 'number' && isFinite(v) ? Math.round(v) : HOST_NEW_SETS;
}
