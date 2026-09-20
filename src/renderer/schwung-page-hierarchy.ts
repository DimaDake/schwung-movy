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
 * THE MODULE'S OWN WORD IS READ BY `chain/hierarchy-source` (SP-20) — three
 * rungs, `ui_hierarchy` then `ui_pages` then `module.json`, shared with movy's
 * model and the undo dump so the three cannot answer differently. What is left
 * here is the rung that belongs to the DELEGATED PAGE alone:
 *
 *   4. movy's own config, translated (SP-14). Only for a module that published
 *      NOTHING on any of the three — never over a module that described itself
 *      — and only here, because Schwung's planner needs a contract or it has
 *      nothing to plan. movy's own model reads the same config natively.
 *
 * THE TRI-STATE SURVIVES ALL FOUR. The controller reads this key with three
 * answers: JSON = declared, "" = served and empty (give up now), null = the read
 * did not complete (hold and ask again). A null must not become movy's
 * translation any more than it may become ui_pages' null: that is the fourth
 * latched-verdict bug this branch has had from collapsing three answers into
 * two, and schwung-late-contract-check exists because of the third. The source
 * reports `pending` and this is the caller that acts on it — its reads go
 * through SP-26's cache, where a null is a read in flight.
 */

import type { PageParamSource } from './schwung-page-source.js';
import type { PageReadCache } from './schwung-page-cache.js';
import { moduleReadKey } from '../chain/config.js';
import { createContractSource } from '../chain/hierarchy-source.js';
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

export function createPageHierarchy(port: PageParamSource, qualify: (k: string) => string,
                                    cache: PageReadCache,
                                    componentKey: string): PageHierarchy {
    /* EVERY READ GOES THROUGH THE CACHE (SP-26), including the module id. A
     * blocking engine GET here would be paid on the `reloadIfChanged` divider
     * for a question whose answer changes once — which is the cost SP-26 took
     * out of this path in the first place. */
    const read = (k: string) => cache.get(qualify(k));

    /* NOT `read`: `moduleReadKey` already returns the key the PORT wants —
     * `synth_module`, with no colon in it — and qualify() would see the missing
     * colon and make it `synth:synth_module`, which nothing serves. The contract
     * lifecycle asks for the same key the same way. */
    const moduleId = () => { try { return cache.get(moduleReadKey(componentKey)); } catch (_e) { return null; } };

    const declared = createContractSource({ read, moduleId, componentKey });

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
        const id = moduleId();
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
        const d = declared.get();
        if (d.text) return d.text;

        /* THE MODULE HAS TO HAVE ANSWERED before movy speaks for it. `pending`
         * is a read in flight: hold, and the controller asks again. */
        if (d.pending) return null;

        return translated() ?? d.served;
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
        invalidate() {
            synthId = null; synthText = null; parsedFrom = null; parsedVal = null;
            declared.invalidate();
        },
    };
}
