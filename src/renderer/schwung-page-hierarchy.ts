/* schwung-page-hierarchy.ts — WHICH CONTRACT THIS PAGE IS PLANNED FROM.
 *
 * One answer, for both of the things that need it. The planner reads it through
 * `io.getParam('ui_hierarchy')` to build the pages; `focusVoice` reads it to turn
 * a pad into a level and a level into a page. Those were two separate readers
 * with two separate fallback ladders, which is how SP-14 would otherwise have
 * half-landed: a rack would get its eleven named pages and a pad press would
 * still find nothing to jump to, because only one of the two readers knew where
 * the hierarchy had come from.
 *
 * THREE SOURCES, IN THIS ORDER, AND MOVY IS LAST:
 *
 *   1. `ui_hierarchy` — what the module publishes. Authoritative, always.
 *   2. `ui_pages` — what a module shipping its own chain editor publishes
 *      instead. 9W9 serves `ui_hierarchy` EMPTY on purpose (the shadow UI
 *      reaches for the hierarchy editor whenever one is offered, and 9W9's RD-9
 *      pad editor is the point of the module) and publishes the same contract
 *      under a key the host does not probe; its own ui_chain.js does exactly
 *      this rewrite to feed this controller.
 *   3. movy's own config, translated (SP-14). Only for a module that published
 *      NEITHER — never over a module that described itself.
 *
 * THE TRI-STATE SURVIVES ALL THREE. The controller reads this key with three
 * answers: JSON = declared, "" = served and empty (give up now), null = the read
 * did not complete (hold and ask again). A null must not become movy's
 * translation any more than it may become ui_pages' null: that is the fourth
 * latched-verdict bug this branch has had from collapsing three answers into
 * two, and schwung-late-contract-check exists because of the third.
 */

import type { TrackPort } from '../track/port.js';
import type { PageReadCache } from './schwung-page-cache.js';
import { moduleReadKey } from '../chain/config.js';
import { loadModuleConfig } from '../modules/loader.js';
import { hierarchyFromConfig } from '../model/config-hierarchy.js';

export interface PageHierarchy {
    /** The contract to plan from, as the controller wants it: a JSON string,
     *  `''` for "there is none", or null for "the read did not complete". */
    raw(): string | null;
    /** The same contract, parsed — null when there is none. */
    parsed(): any | null;
    /** Forget the translation. A re-plan, or a module swap. */
    invalidate(): void;
}

export function createPageHierarchy(port: TrackPort, qualify: (k: string) => string,
                                    cache: PageReadCache,
                                    componentKey: string): PageHierarchy {
    /* EVERY READ GOES THROUGH THE CACHE (SP-26), including the module id. A
     * blocking engine GET here would be paid on the `reloadIfChanged` divider
     * for a question whose answer changes once — which is the cost SP-26 took
     * out of this path in the first place. */
    const read = (k: string) => cache.get(qualify(k));

    /* THE TRANSLATION IS MEMOIZED, AND THE SAME STRING COMES BACK EVERY TIME.
     * `reloadIfChanged` fingerprints the contract every 8 ticks; a freshly
     * stringified object per call is a new fingerprint per call, and the page
     * would re-plan forever — the cost SP-27 measured, self-inflicted. Keyed by
     * module id so a slot swap re-translates and `''` (no module) does not
     * stand for the module that has just left. */
    let synthId: string | null = null;
    let synthText: string | null = null;

    /* Parsing is memoized against the exact string it came from. minijv's
     * contract is 39 KB; `focusVoice` runs on every pad press, and re-parsing
     * that per press was the shape of cost this migration keeps finding. */
    let parsedFrom: string | null = null;
    let parsedVal: any = null;

    function translated(): string | null {
        /* NOT `read`: `moduleReadKey` already returns the key the PORT wants
         * — `synth_module`, with no colon in it — and qualify() would see the
         * missing colon and make it `synth:synth_module`, which nothing serves.
         * The contract lifecycle asks for the same key the same way. */
        let id: string | null = null;
        try { id = cache.get(moduleReadKey(componentKey)); } catch (_e) { id = null; }
        /* No module id yet is not "no rack" — it is a read that has not landed,
         * and answering "" for it would latch a verdict the same way. */
        if (!id) return null;
        if (id === synthId) return synthText;
        synthId = id;
        synthText = null;
        try {
            const h = hierarchyFromConfig(loadModuleConfig(id, componentKey));
            if (h) synthText = JSON.stringify(h);
        } catch (_e) { /* a config movy cannot read is a config movy does not have */ }
        return synthText;
    }

    function raw(): string | null {
        const own = read('ui_hierarchy');
        if (own !== null && own !== undefined && own !== '') return own;

        const alt = read('ui_pages');
        if (alt !== null && alt !== undefined && alt !== '') return alt;

        /* THE MODULE HAS TO HAVE ANSWERED before movy speaks for it. `own ===
         * null` is a read in flight: hold, and the controller asks again. */
        if (own === null || own === undefined) return own ?? null;

        return translated() ?? own;
    }

    return {
        raw,
        parsed() {
            const s = raw();
            if (!s) { parsedFrom = null; parsedVal = null; return null; }
            if (s === parsedFrom) return parsedVal;
            parsedFrom = s;
            try { parsedVal = JSON.parse(s); } catch (_e) { parsedVal = null; }
            return parsedVal;
        },
        invalidate() { synthId = null; synthText = null; parsedFrom = null; parsedVal = null; },
    };
}
