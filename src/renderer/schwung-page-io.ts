/* schwung-page-io.ts — the io movy injects into Schwung's page controller.
 *
 * Injected I/O — rule 1 of param_pages: the library does no param I/O, the
 * caller does every read and write. That is what keeps movy's port the one
 * thing talking to the track. It is built here rather than inline in the
 * binding so the contract lifecycle and the render path can be read without
 * scrolling past it.
 */

import type { TrackPort } from '../track/port.js';
import type { PageReadCache } from './schwung-page-cache.js';
import type { PageHierarchy } from './schwung-page-hierarchy.js';

/* EVERY READ GOES THROUGH THE CACHE. Schwung asks one key per tick and would
 * otherwise spend a blocking engine GET on each — SP-26, and
 * `browser-test/logic/page-owner.mjs` greps this file for a `port.getParam`
 * that walks around it. */
export function createPageIo(port: TrackPort, qualify: (k: string) => string,
                             cache: PageReadCache, hierarchy: PageHierarchy) {
    const read = (k: string) => cache.get(qualify(k));
    return {
        /*
         * `ui_hierarchy` IS ANSWERED BY schwung-page-hierarchy, not read here.
         * The module's own contract, then `ui_pages` for a module that ships
         * its own chain editor, then movy's config translated for a rack that
         * published neither (SP-14) — one ladder, because `focusVoice` climbs
         * the same one and two readers of one contract is precisely how a pad
         * press ended up with no page to jump to.
         */
        getParam: (k: string) => {
            /* MATCHED ON THE SUFFIX, because the controller asks with the
             * component already on the key — `synth:ui_hierarchy`, not
             * `ui_hierarchy`. Comparing the whole string never matched and the
             * fallback silently never ran. */
            if (String(k).endsWith('ui_hierarchy')) return hierarchy.raw();
            return read(k);
        },
        setParam: (k: string, v: string) => { port.setParam(qualify(k), v); },
        /* movy has its own screen-reader path; nothing to say from here yet. */
        announce: () => {},
    };
}
