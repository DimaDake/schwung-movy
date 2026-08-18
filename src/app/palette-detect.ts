/* Which LED palette is this host running?
 *
 * schwung PR #185 recoloured the table — same constant names, different values
 * — so movy's hardcoded INDICES paint different colours depending on the host.
 * The host's own modules are unaffected because they import the names; the
 * compatibility aliases cover names, not indices.
 *
 * Detected by reading schwung's constants.mjs rather than importing it: the
 * device build treats `/data/UserData/schwung/shared/*` as external, a static
 * import would be evaluated at load, and a missing export is a link-time
 * failure that takes the whole module down. A file read cannot fail that way,
 * costs one call at init, and works on every host version.
 *
 * The marker is a colour value only the recoloured table has. A name would be
 * the more obvious probe and is the wrong one: the merge restored every deleted
 * name as an alias, so names are identical across the two. */

import { mlog } from '../log.js';
import { setPaletteRecoloured } from '../seq/colors.js';

const CONSTANTS = '/data/UserData/schwung/shared/constants.mjs';
/* Bright Orange, index 3. #FF9900 in every released schwung, #C93C00 after the
 * recolour. Movy uses index 3 in both of its tables, so this is a colour whose
 * change movy actually feels. */
const RECOLOURED_MARKER = '#C93C00';

export function detectPalette(): void {
    if (typeof host_read_file !== 'function') return;   // browser tests
    let src: string | null = null;
    try { src = host_read_file(CONSTANTS); } catch { src = null; }
    if (!src) {
        /* Reading it is not essential — the released palette is the safe
         * default — but a silent fallback would hide a host layout change. */
        mlog('palette: constants.mjs unreadable, assuming released palette');
        return;
    }
    const recoloured = src.indexOf(RECOLOURED_MARKER) >= 0;
    setPaletteRecoloured(recoloured);
    mlog('palette: ' + (recoloured ? 'recoloured (PR #185)' : 'released'));
}
