/* What movy shows when it cannot become live, and the one way out.
 *
 * Split from set-session.ts to keep that file the lifecycle and nothing else —
 * and because these are the paths a user actually hits when something is wrong,
 * which deserve to be readable on their own. */

import { mlog } from '../log.js';
import { flagValue } from './flags.js';
import { BLANK_STATE } from './set-context.js';
import { readBestState, writeStateBlob } from './persist-store.js';
import { captureVersion } from './version-capture.js';
import { bumpGen, clearFailure, currentGen, currentSetUuid } from './set-session.js';

/* Give up on this Set's stored state and start it empty.
 *
 * The host exposes no delete, so "start from scratch" is a blank state written
 * OVER the old one rather than a removal. That is the same operation the user
 * would get from a fresh Set, and it is deliberately theirs to trigger: a Set
 * that will not load is usually still recoverable by hand off the device, and
 * movy silently blanking it would destroy the only copy. */
export function sessionStartFromScratch(): void {
    mlog('seq: starting ' + (currentSetUuid() || 'this set') + ' from scratch on request');
    const id = currentSetUuid() || '_default';
    /* Engine-owned: it captures the pre-wipe version and removes the state
     * files itself. Writing a blank blob from here would leave the engine's own
     * files untouched, and the Set the user asked to be rid of would come
     * straight back on the next open. */
    if (flagValue('engpersist')) {
        if (typeof host_module_set_param_blocking === 'function')
            host_module_set_param_blocking('set', 'blank ' + id, 200);
        bumpGen();
        clearFailure();
        return;
    }
    /* The Set about to be blanked, kept unconditionally. This is the capture
     * the whole version history exists for: the user is one press away from
     * losing work movy can still see. */
    const stored = readBestState(id);
    if (stored) captureVersion(id, 'pre-wipe', stored.payload, stored.gen);
    writeStateBlob(id, BLANK_STATE, currentGen() + 1);
    bumpGen();
    clearFailure();
}

