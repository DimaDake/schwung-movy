/* Which flags the page LISTS.
 *
 * Some of them are settings a user is entitled to. The rest are measurement
 * instruments, and a release build hides them. Filtering here rather than in the
 * page keeps `FLAGS` the single description of a flag: `release` is one more
 * field on the entry, not a second list to keep in step.
 *
 * The page walks THIS list, not `FLAGS` — it indexes rows by position, so a
 * filtered list read through the raw table would edit the wrong flag. */

import { FLAGS, type FlagDef } from './flags-def.js';
import { DEBUG_BUILD } from '../app/debug.js';

/** `debug` is a parameter so a test can ask for the release list from a build
 *  that has the debug surfaces compiled in — otherwise what ships is the one
 *  arrangement no suite can see. */
export function visibleFlags(debug: boolean = DEBUG_BUILD): FlagDef[] {
    const out: FlagDef[] = [];
    for (const f of FLAGS) {
        if (!debug && !f.release) continue;
        out.push(f);
    }
    return out;
}
