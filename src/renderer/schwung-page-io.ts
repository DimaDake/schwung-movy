/* schwung-page-io.ts — the io movy injects into Schwung's page controller.
 *
 * Injected I/O — rule 1 of param_pages: the library does no param I/O, the
 * caller does every read and write. That is what keeps movy's port the one
 * thing talking to the track. It is built here rather than inline in the
 * binding so the contract lifecycle and the render path can be read without
 * scrolling past it.
 */

import type { TrackPort } from '../track/port.js';

export function createPageIo(port: TrackPort, qualify: (k: string) => string) {
    return {
        /*
         * `ui_hierarchy` FALLS BACK TO `ui_pages`, which is what a module
         * shipping its own chain editor publishes under.
         *
         * 9W9 serves `ui_hierarchy` EMPTY on purpose — the shadow UI reaches
         * for the hierarchy editor whenever one is offered, and 9W9's RD-9 pad
         * editor is the point of the module — and publishes the same contract
         * under a key the host does not probe. Its own ui_chain.js does exactly
         * this rewrite to feed this controller; movy is the same kind of caller
         * and needs the same one.
         *
         * Without it the controller planned from `chain_params` alone: 13 pages
         * of "Params - 2", "Params - 3", with no level on any of them, instead
         * of one page per voice named Bass Drum, Snare, Low Tom. Measured on
         * device — it is why a pad press had no page to jump to.
         */
        getParam: (k: string) => {
            const v = port.getParam(qualify(k));
            if (v !== null && v !== undefined && v !== '') return v;
            /* MATCHED ON THE SUFFIX, because the controller asks with the
             * component already on the key — `synth:ui_hierarchy`, not
             * `ui_hierarchy`. Comparing the whole string never matched and the
             * fallback silently never ran. */
            const key = String(k);
            if (!key.endsWith('ui_hierarchy')) return v;
            const alt = port.getParam(qualify(key.replace('ui_hierarchy', 'ui_pages')));
            /*
             * THE FALLBACK MUST NOT DESTROY THE TRI-STATE. The controller reads
             * this key with three answers: JSON = declared, "" = served and
             * empty (give up now), null = the read did not complete (hold and
             * ask again). Returning `alt` unconditionally turned an EMPTY
             * answer — a module that left the slot — into ui_pages' null, so
             * the page held "ready" forever and movy never got the frame back.
             * schwung-late-contract-check caught it; that is the fourth time in
             * this branch a latched verdict has come from collapsing those
             * three answers into two.
             */
            return (alt !== null && alt !== undefined && alt !== '') ? alt : v;
        },
        setParam: (k: string, v: string) => { port.setParam(qualify(k), v); },
        /* movy has its own screen-reader path; nothing to say from here yet. */
        announce: () => {},
    };
}
