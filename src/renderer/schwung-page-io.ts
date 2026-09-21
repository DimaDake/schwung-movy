/* schwung-page-io.ts — the io movy injects into Schwung's page controller.
 *
 * Injected I/O — rule 1 of param_pages: the library does no param I/O, the
 * caller does every read and write. That is what keeps movy's port the one
 * thing talking to the track. It is built here rather than inline in the
 * binding so the contract lifecycle and the render path can be read without
 * scrolling past it.
 */

import type { PageParamSource } from './schwung-page-source.js';
import type { PageReadCache } from './schwung-page-cache.js';
import type { PageHierarchy } from './schwung-page-hierarchy.js';
import { isContractKey } from '../chain/hierarchy-source.js';
import type { PageAutomation } from '../types/page-automation.js';

/* EVERY READ GOES THROUGH THE CACHE. Schwung asks one key per tick and would
 * otherwise spend a blocking engine GET on each — SP-26, and
 * `browser-test/logic/page-owner.mjs` greps this file for a `port.getParam`
 * that walks around it. */
export function createPageIo(port: PageParamSource, qualify: (k: string) => string,
                             cache: PageReadCache, hierarchy: PageHierarchy,
                             componentKey: string,
                             modulatedKeys: (() => ReadonlySet<string> | null) | null,
                             automation: (() => PageAutomation | null) | null = null) {
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
        const full = String(k);
        /*
         * AN AUTOMATED PARAMETER ANSWERS YES HERE, AND THAT IS A DELIBERATE
         * WIDENING OF THE WORD (SP-36).
         *
         * `isModulated` is what buys the whole reading the reporter asked for:
         * the controller keeps the POINTER at `<key>:base` and rides a mark
         * along the arc at `<key>:effective` — "the pointer stays where you set
         * it, and the automation shows as a mark moving across the knob, like
         * with lfo", in their words. A lane moves a parameter exactly the way
         * an LFO does, so the channel is the right one and nothing upstream has
         * to change to get it.
         *
         * WHAT IT COSTS is the grammar: movy's own renderer says tilde for
         * modulation and a 2x2 dot for automation, and this makes both read as
         * a tilde. The distinction is worth a per-cell channel of its own and
         * that channel is upstream (SU-8 in `docs/schwung-page-migration.md`),
         * not a second mark movy paints into Schwung's cell.
         */
        const auto = automation ? automation() : null;
        if (auto && auto.isAutomated(qualify(full))) return true;
        const keys = modulatedKeys ? modulatedKeys() : null;
        if (!keys) return false;
        return keys.has(full.startsWith(prefix) ? full.slice(prefix.length) : full);
    };
    /*
     * `:base` AND `:effective` ARE THE SAME PARAMETER, ASKED TWO WAYS, and for
     * an automated key only one of them can come from the port.
     *
     * The engine emits the lane's value as a CC and the chain applies it inside
     * the DSP, so a read of the plain key answers what the LANE is doing — the
     * base is not there to be read, and before this it was the base that went
     * missing while the pointer chased the lane. So: `:effective` is the live
     * read (the port already holds it), and `:base` is movy's own record of
     * what the user dialled in (`seq/automation-base.ts`).
     *
     * ANYTHING ELSE FALLS THROUGH UNCHANGED, AND AN LFO TARGET ESPECIALLY —
     * this must not be widened to every key `isModulated` reports. A chain
     * modulation target is served by the host: since schwung #276 its PLAIN key
     * answers the BASE and `:effective` answers the driven value, so answering
     * `:effective` with the plain read there would put the dot exactly on the
     * pointer and leave it there. It is right for an automated key only because
     * movy knows what the plain key holds for one: the lane's own value, which
     * the chain applied inside the DSP.
     *
     * WHAT THE `:effective` ANSWER BUYS IS THE READ, NOT THE DOT. The
     * controller falls back to the plain key when `:effective` does not answer
     * (`refreshModulatedValues`), so the dot arrives either way — but the
     * engine does not serve that key, a null is never cached
     * (`schwung-page-cache.ts`), and the controller asks for one modulated key
     * EVERY tick. Unanswered, that is a live blocking engine GET per tick which
     * can never succeed. Measured in `logic/page-automation.mjs`: 39 asks
     * across 40 ticks, against 0.
     */
    const SUF_BASE = ':base', SUF_EFF = ':effective';
    const decorated = (k: string): string | null => {
        const auto = automation ? automation() : null;
        if (!auto) return null;
        if (k.endsWith(SUF_BASE)) {
            const bare = k.slice(0, -SUF_BASE.length);
            const b = auto.baseOf(qualify(bare));
            return b === null ? null : String(b);
        }
        if (k.endsWith(SUF_EFF)) {
            const bare = k.slice(0, -SUF_EFF.length);
            return auto.isAutomated(qualify(bare)) ? read(bare) : null;
        }
        return null;
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
            const d = decorated(String(k));
            return d === null ? read(k) : d;
        },
        /* A TURN UNDER THIS PAGE IS AN EDIT OF THE BASE, so the record of the
         * base moves with it — otherwise the next `:base` read snaps the
         * pointer back to what the user set before this turn. The engine hears
         * the same number on the release (`abaseq`, seq/automation.ts); this is
         * the half that keeps the SCREEN honest in between. */
        setParam: (k: string, v: string) => {
            const auto = automation ? automation() : null;
            if (auto) {
                const n = parseFloat(v);
                if (!isNaN(n)) auto.noteBase(qualify(k), n);
            }
            port.setParam(qualify(k), v);
        },
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
        /* Both undefined for a real module's port today, unchanged — only a
         * source that declares them (SP-53's virtual components) supplies
         * anything here. Passed straight through: the SOURCE decides what a
         * key looks like, this file only wires the hook up. */
        vizOverrides: port.vizOverrides ? (k: string) => port.vizOverrides!(k) : undefined,
        formatValue: port.formatValue
            ? (fullKey: string, raw: string | null, surface: 'cell' | 'header') =>
                  port.formatValue!(fullKey, raw, surface)
            : undefined,
    };
}
