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
 *   4. movy's own config, translated (SP-14). For a module that published
 *      nothing on any of the three, and — the user's ruling of 2026-10-05 —
 *      ALSO over a module that published a contract but not a modern drum rack
 *      (`declaresModernRack`), when movy's config describes a rack: the older
 *      drum modules (forge, mrdrums, weird-dreams, signal, libpo32) play better
 *      from movy's curated banks. A config that describes no rack translates
 *      to nothing, so a synth's own declaration is never outvoted. Only here,
 *      because Schwung's planner needs a contract or it has nothing to plan;
 *      movy's own model reads the same config natively.
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
import { declaresModernRack } from '../model/modern-rack.js';

export interface PageHierarchy {
    /** The contract to plan from, as the controller wants it: a JSON string,
     *  `''` for "there is none", or null for "the read did not complete". */
    raw(): string | null;
    /** The same contract, parsed — null when there is none. */
    parsed(): any | null;
    /** The contract as LAST read, parsed, with no read of its own — for a
     *  question asked on every controller read (schwung-page-focus.ts). The
     *  controller re-reads the contract on its own poll, which keeps it fresh. */
    peek(): any | null;
    /** Forget the translation. A re-plan, or a module swap. */
    invalidate(): void;
}

/** Unanswered module-id asks before a declaration is taken as final. */
const ID_MISS_LIMIT = 3;

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

    /* Kept only when there IS an answer: a read in flight is not "no
     * contract", and `peek` must not flicker to null across it. */
    let lastRaw: string | null = null;
    function raw(): string | null {
        const r = readRaw();
        if (r) lastRaw = r;
        return r;
    }
    function parse(s: string | null): any {
        if (!s) { parsedFrom = null; parsedVal = null; return null; }
        if (s === parsedFrom) return parsedVal;
        parsedFrom = s;
        try { parsedVal = JSON.parse(s); } catch (_e) { parsedVal = null; }
        return parsedVal;
    }

    /* THE VERDICT ON A DECLARATION IS MEMOIZED AGAINST ITS TEXT, module id
     * included. Asking the id per ask put one more host trip on every reload
     * poll of every synth that declares a contract (schwung-page-idle-cost),
     * for an answer that changes only with the contract or a module swap —
     * and a swap calls `invalidate`. */
    let verdictFrom: string | null = null;
    let verdictVal: string | null = null;
    let idMisses = 0;
    function latch(text: string, val: string): string {
        verdictFrom = text; verdictVal = val; idMisses = 0;
        return val;
    }
    function overDeclared(text: string, levels: unknown): string {
        if (text === verdictFrom) return verdictVal as string;
        if (declaresModernRack(levels)) return latch(text, text);
        /* NOT a hold while the id is in flight: that would delay every synth's
         * first plan for five racks. The id rides the same cache as the
         * contract and is normally already there; until it is, the declaration
         * stands. A cache null is never cached, so an id that never answers
         * would be one live read per ask, forever — after a few, the
         * declaration latches. */
        if (!moduleId()) return ++idMisses >= ID_MISS_LIMIT ? latch(text, text) : text;
        return latch(text, translated() ?? text);
    }

    function readRaw(): string | null {
        const d = declared.get();
        if (d.text) return overDeclared(d.text, d.levels);

        /* THE MODULE HAS TO HAVE ANSWERED before movy speaks for it. `pending`
         * is a read in flight: hold, and the controller asks again. */
        if (d.pending) return null;

        return translated() ?? d.served;
    }

    return {
        raw,
        parsed: () => parse(raw()),
        peek: () => parse(lastRaw),
        invalidate() {
            synthId = null; synthText = null; parsedFrom = null; parsedVal = null; lastRaw = null;
            verdictFrom = null; verdictVal = null; idMisses = 0;
            declared.invalidate();
        },
    };
}
