/* hierarchy-source.ts — THE ONE READER OF A COMPONENT'S DECLARED PAGE CONTRACT.
 *
 * SP-20. Three sites read the same contract with three different ladders and
 * two different tests for "the module said nothing": the delegated page
 * (renderer/schwung-page-hierarchy, which also answers `focusVoice`), movy's own
 * model (model/hierarchy) and the undo dump's restore order
 * (undo/module-dump's listParamOf). Two readers of one contract is how a pad
 * press ended up with no page to jump to (SP-14), and here it had already cost
 * two more:
 *
 *   - `module.json` was invisible to the PAGE. Schwung serves a SYNTH slot's
 *     `ui_hierarchy` from the plugin alone, so a module that describes its UI in
 *     its manifest (Slicer) arrives with none. The model reads the manifest; the
 *     planner did not, so under `page` that module got whatever `chain_params`
 *     paginates to and its declared file browser was unreachable.
 *   - `"{}"` was a DECLARATION to the page and NOTHING to the model. A module
 *     that serves an empty object (the device does this) stopped the page at
 *     rung 1 — no `ui_pages`, no manifest, no translation — while the model
 *     climbed on. The model's test is the right one: a contract counts when it
 *     declares LEVELS, not when it is non-empty text.
 *
 * THE RUNGS, IN ORDER, AND ALL THREE ARE THE MODULE'S OWN WORD:
 *
 *   1. `ui_hierarchy` — what the module publishes. Authoritative, always.
 *   2. `ui_pages` — what a module shipping its own chain editor publishes
 *      instead. 9W9 serves `ui_hierarchy` empty on purpose (the shadow UI
 *      reaches for the hierarchy editor whenever one is offered, and 9W9's RD-9
 *      pad editor is the point of the module) and publishes the same contract
 *      under a key the host does not probe; its own ui_chain.js does exactly
 *      this rewrite to feed that controller.
 *   3. `module.json`'s `capabilities.ui_hierarchy` — the same file schwung
 *      parses for the slot's own param table. Only FX and MIDI FX slots get it
 *      served back as a param, so for a synth this is the only way to hear it.
 *
 * MOVY'S OWN CONFIG IS NOT A RUNG. Translating it (SP-14) is the DELEGATED
 * PAGE's last resort, because Schwung's planner needs a contract or it has
 * nothing to plan; movy's model consumes `movy_config` natively through
 * `buildConfigPages`, and a translated hierarchy there would make movy's own
 * table indistinguishable from the module's declaration — `readSurface` would
 * read it as declared voices and outvote the table it came from. So rung 4
 * stays in renderer/schwung-page-hierarchy, after this ladder resolves empty.
 *
 * `pending` IS REPORTED, NOT ACTED ON. The page reads through SP-26's cache,
 * where `null` means the read has not landed and answering for the module would
 * latch a verdict — the fourth latched-verdict bug this branch has had from
 * collapsing three answers into two. The model and the dump read through a
 * BLOCKING port, where `null` means the param does not exist. One ladder, two
 * read semantics, and which one applies is the caller's to say.
 *
 * Lives in `chain/` because all three callers can reach it: `model/` may not
 * import `renderer/`, and `undo/` stays clear of `model/`.
 */

import { loadModuleJson } from '../modules/loader.js';
import { mlog } from '../log.js';

export type ContractSource = 'ui_hierarchy' | 'ui_pages' | 'module.json';

export interface HierLevels { levels?: Record<string, unknown> }

export interface DeclaredContract {
    /** The contract to plan from as JSON text, or null when the module
     *  declared none. Never a text that declares no levels. */
    readonly text: string | null;
    /** Which rung answered — for the log line, and for a test that has to see
     *  WHICH source a page was planned from rather than that one was found. */
    readonly source: ContractSource | null;
    /** Rung 1's own answer, verbatim: `''` or `'{}'` when the module served one
     *  and declared nothing in it. The give-up token a caller hands on. */
    readonly served: string | null;
    /** Rung 1 did not answer. Only a caller whose reads can be in flight (the
     *  page cache) may treat this as "hold and ask again". */
    readonly pending: boolean;
    /** The same contract, already parsed — the ladder had to parse it to know
     *  it declared anything, and minijv's is 39 KB, so a caller that wants the
     *  levels takes THIS rather than parsing the text a second time. Null
     *  exactly when `text` is. */
    readonly levels: HierLevels | null;
}

export interface ContractIo {
    /** BARE key — `ui_hierarchy`, not `synth:ui_hierarchy`. The caller qualifies
     *  it the way its own port wants, which is the one thing the three callers
     *  genuinely do differently. */
    read(key: string): string | null | undefined;
    /** The module in the slot, or null/'' when the read has not landed. */
    moduleId(): string | null;
    componentKey: string;
}

/** Does this object declare any level? The one test for "the module said
 *  something", applied to every rung — `{}` is a module saying nothing. */
export function hasLevels(h: unknown): h is HierLevels {
    const lv = (h as HierLevels | null)?.levels;
    return !!lv && Object.keys(lv).length > 0;
}

/** The parsed contract, or null when the text declares no levels. A text that
 *  parses to `{}` is a module saying nothing in JSON, not a declaration. */
export function levelsOf(text: string | null | undefined): HierLevels | null {
    if (!text) return null;
    try {
        const h = JSON.parse(text) as HierLevels;
        if (hasLevels(h)) return h;
    } catch (_e) {
        /* A contract movy cannot parse is a contract movy does not have — but it
         * is the module saying something movy then ignores, which is worth one
         * device line rather than a page that is simply missing. Rare: the
         * callers memoize this. */
        mlog('hierarchy-source: contract parse error');
    }
    return null;
}

/** Does this key ask for the declared contract? MATCHED ON THE SUFFIX: the page
 *  controller asks with the component already on the key (`synth:ui_hierarchy`),
 *  so a whole-string comparison never matched and the fallback silently never
 *  ran. Here, so the io that routes the ask holds no key literal of its own. */
export function isContractKey(k: string): boolean {
    return String(k).endsWith('ui_hierarchy');
}

/**
 * A memoizing reader for one component's contract. The manifest rung is a
 * blocking `host_read_file` and `get()` is on the pad-press path as well as the
 * re-plan divider (SP-27 measured what a re-read per call costs there), so it is
 * cached against the module id it was read for — a slot swap re-reads, and `''`
 * (no module yet) never stands for the module that has just left.
 */
export function createContractSource(io: ContractIo) {
    let manifestId: string | null = null;
    let manifestText: string | null = null;
    let manifestLevels: HierLevels | null = null;

    /* THE LEVELS TEST IS MEMOIZED AGAINST THE EXACT STRING IT RAN ON, and it has
     * to be: `get()` is called on the page's reload divider, where minijv's
     * contract is 39 KB of JSON, and parsing it to answer "did the module say
     * anything?" is 2.8 ms of work thrown away per reload — the exact cost SP-27
     * took out of this path, re-introduced one question earlier.
     * `browser-test/grid-cost.mjs` counts the parses and wants zero. */
    function memoLevels() {
        let from: string | null | undefined;
        let val: HierLevels | null = null;
        return (text: string | null | undefined): HierLevels | null => {
            if (text === from) return val;
            from = text;
            val = levelsOf(text);
            return val;
        };
    }
    const ownLevels = memoLevels();
    const altLevels = memoLevels();

    function fromManifest(): string | null {
        let id: string | null = null;
        try { id = io.moduleId(); } catch (_e) { id = null; }
        if (!id) return null;
        if (id === manifestId) return manifestText;
        manifestId = id;
        manifestText = null;
        manifestLevels = null;
        try {
            const hier = loadModuleJson(id, io.componentKey)?.capabilities?.ui_hierarchy;
            if (hasLevels(hier)) { manifestLevels = hier; manifestText = JSON.stringify(hier); }
        } catch (_e) { /* a manifest movy cannot read is a manifest movy does not have */ }
        return manifestText;
    }

    return {
        get(): DeclaredContract {
            const own = io.read('ui_hierarchy');
            const served = own === undefined ? null : own;
            const ownLv = ownLevels(own);
            if (ownLv) return { text: own as string, source: 'ui_hierarchy', served,
                                pending: false, levels: ownLv };

            const alt = io.read('ui_pages');
            const altLv = altLevels(alt);
            if (altLv) return { text: alt as string, source: 'ui_pages', served,
                                pending: false, levels: altLv };

            const manifest = fromManifest();
            if (manifest) return { text: manifest, source: 'module.json', served,
                                   pending: false, levels: manifestLevels };

            return { text: null, source: null, served, levels: null,
                     pending: own === null || own === undefined };
        },
        /** Forget the manifest. A re-plan, or a module swap. */
        invalidate(): void { manifestId = null; manifestText = null; manifestLevels = null; },
    };
}

/** The one-shot form, for a caller with nothing to memoize against — a dump, or
 *  a model load that happens once per module. */
export function declaredContract(io: ContractIo): DeclaredContract {
    return createContractSource(io).get();
}
