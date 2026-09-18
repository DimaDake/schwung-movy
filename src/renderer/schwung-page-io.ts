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
import { isContractKey } from '../chain/hierarchy-source.js';

/* EVERY READ GOES THROUGH THE CACHE. Schwung asks one key per tick and would
 * otherwise spend a blocking engine GET on each — SP-26, and
 * `browser-test/logic/page-owner.mjs` greps this file for a `port.getParam`
 * that walks around it. */
export function createPageIo(port: TrackPort, qualify: (k: string) => string,
                             cache: PageReadCache, hierarchy: PageHierarchy,
                             componentKey: string,
                             modulatedKeys: (() => ReadonlySet<string> | null) | null) {
    const read = (k: string) => cache.get(qualify(k));
    /*
     * THE KEY FORM IS THE ONE THING THIS FILE HAS TO GET RIGHT ABOUT MODULATION.
     *
     * The controller asks with the COMPONENT ALREADY ON THE KEY —
     * `isModulated('synth:cutoff')`, built as `${s.prefix}:${childResolve(...)}`
     * with `s.prefix = component` — while the set movy keeps holds bare io keys
     * (`cutoff`), because that is the form `lfo1:target_param` is written in. So
     * the full key is STRIPPED OF THIS PAGE'S OWN PREFIX, which is precisely the
     * inverse of `qualify` above and for exactly the same reason.
     *
     * Stripping at the FIRST colon would be wrong: a namespaced component
     * (`master_fx:delay`) would leave `fx:delay:cutoff`. The prefix is the whole
     * component key or nothing — the same rule `qualify` applies on the way in.
     *
     * Reading through the port is not available here either — every read in this
     * file goes through the cache (see the header) — so the answer arrives as an
     * INJECTED live lookup rather than as a Set: a page outlives the module that
     * built it (schwung-grid.ts caches by track and component), so a captured
     * Set would answer for the module that has since been swapped out.
     *
     * Cost: the controller asks once per tick, on the read cursor's own rotation
     * — one key per tick — so this is a Set lookup against reads the page was
     * already paying for. Nothing new is read.
     */
    const prefix = componentKey + ':';
    const isModulated = (k: string): boolean => {
        const keys = modulatedKeys ? modulatedKeys() : null;
        if (!keys) return false;
        const full = String(k);
        return keys.has(full.startsWith(prefix) ? full.slice(prefix.length) : full);
    };
    return {
        /*
         * `ui_hierarchy` IS ANSWERED BY schwung-page-hierarchy, not read here.
         * The module's own word comes from `chain/hierarchy-source` — its own
         * contract, then `ui_pages` for a module that ships its own chain
         * editor, then `module.json` — and movy's config translated (SP-14) is
         * the page's own last rung for a rack that published none of the three.
         * One ladder, because `focusVoice` climbs the same one and two readers
         * of one contract is precisely how a pad press ended up with no page to
         * jump to.
         */
        getParam: (k: string) => {
            /* The test is the SOURCE's (`isContractKey`): the controller asks
             * with the component already on the key, so it matches the suffix,
             * and a key literal here would be a second reader of the contract
             * in the one file that must not have one. */
            if (isContractKey(k)) return hierarchy.raw();
            return read(k);
        },
        setParam: (k: string, v: string) => { port.setParam(qualify(k), v); },
        /* THE THREE MARKS ON A CELL, and which channel each one rides.
         *
         * `isModulated` is the wave-mark tilde — "something is MOVING this",
         * which movy reads from its own LFO routing. The mod dot is not asked
         * for here: the controller follows it by reading `<key>:effective` on a
         * bounded lane and handing the values to the renderer, so it arrives for
         * free once this channel answers. `locked` is a different channel again
         * — `setDecorations`, driven by the automation view — which is the whole
         * reason a tilde and a lock can be told apart at all; under `page` with
         * no `isModulated` both collapsed to the lock mark. */
        isModulated,
        /* movy has its own screen-reader path; nothing to say from here yet. */
        announce: () => {},
    };
}
