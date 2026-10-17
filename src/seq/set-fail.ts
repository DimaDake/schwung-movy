/* What movy shows when it cannot become live, and the one way out.
 *
 * Split from set-session.ts to keep that file the lifecycle and nothing else —
 * and because these are the paths a user actually hits when something is wrong,
 * which deserve to be readable on their own. */

import { paramSet } from '../host/param.js';
import { mlog } from '../log.js';
import { clearFailure, currentSetUuid } from './set-session.js';

/* Give up on this Set's stored state and start it empty.
 *
 * Deliberately the user's to trigger: a Set that will not load is usually
 * still recoverable by hand off the device, and movy silently blanking it
 * would destroy the only copy. */
export function sessionStartFromScratch(): void {
    mlog('seq: starting ' + (currentSetUuid() || 'this set') + ' from scratch on request');
    const id = currentSetUuid() || '_default';
    /* The engine captures the pre-wipe version and removes the state files
     * itself. Writing a blank blob from here would leave the engine's own files
     * untouched, and the Set the user asked to be rid of would come straight
     * back on the next open. */
    paramSet('set', 'blank ' + id);
    clearFailure();
}

