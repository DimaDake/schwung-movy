/* config-hierarchy.ts — movy's own config, restated as a Schwung contract.
 *
 * SP-14, Cause E. Four racks — 6W6, 8W8, 9W9, CW-78 — declare their voices the
 * MOVY way: a bundled config whose banks carry `pad`. Schwung's planner has
 * never heard of that, so under `page` it sees a module with no `ui_hierarchy`
 * at all and paginates `chain_params`: ten pages named "Params" through
 * "Params - 10", no level on any of them, `voicesOf` returning nothing, and a
 * pad press with nowhere to jump. Measured against the 2026-09-13 capture; it
 * is the most dramatic user-visible regression in the migration.
 *
 * Schwung's `voicesOf` has been ready the whole time and no module movy pages
 * feeds it. Decision 2 keeps third-party module repos off the critical path, so
 * the translation is movy's: it already knows these racks, and what it knows is
 * expressible in the declaration a module would ship.
 *
 * ONLY WHERE THE MODULE SAID NOTHING. A module with its own `ui_hierarchy` is
 * authoritative and is never overridden — that is the direction this whole
 * migration runs in, and a movy table that outvoted a module's own words would
 * be the second implementation being removed, re-installed one layer down. The
 * caller (renderer/schwung-page-hierarchy) reaches here only after the module's
 * own contract has come back RESOLVED and empty.
 *
 * PURE, AND FREE OF SCHWUNG. Plain config in, plain object out: `model/` may not
 * import `renderer/`, and this has to be testable without a schwung checkout —
 * the same rule drum-declared.ts follows for the opposite direction of travel.
 */
import type { ModuleConfig, BankConfig } from '../types/param.js';
import { buildRotation } from './page-rotation.js';

/** A level key movy invents, from the bank name the user already sees. */
function slug(name: string): string {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'bank';
}

/** The keys a bank draws, with the row padding dropped. A config pads its rows
 *  with nulls to fill a page (config-pages.ts does the same downstream); a null
 *  is not a parameter, and a level claiming one plans an empty cell. */
function keysOf(bank: BankConfig): string[] {
    const out: string[] = [];
    for (const row of bank.rows || []) {
        for (const slot of row || []) if (slot && slot.key) out.push(slot.key);
    }
    return out;
}

/**
 * The Schwung hierarchy a movy config describes, or null when it describes no
 * rack — which is most configs, and must stay null so nothing starts planning
 * voice pages for a synth.
 *
 * THE VOICE RUN IS `buildRotation`'S, NOT A SECOND COPY OF IT. movy's own
 * renderer already decides which banks are voices — the LEADING run of
 * pad-declaring banks — and the rule is load-bearing rather than pedantic: the
 * configs these four modules SHIP declare `pad` on page-only banks too (a spare
 * grid seat that opens Master), which reads as "every bank is a voice" and
 * collapses the module to one page. That is why movy ships replacements. Asking
 * page-rotation keeps one definition of "voice", so movy's page order and
 * Schwung's cannot drift apart.
 */
export function hierarchyFromConfig(cfg: ModuleConfig | null | undefined): any | null {
    const banks = cfg && cfg.banks;
    if (!banks || !banks.length) return null;

    const { voiceCount } = buildRotation(banks.map((b) => b.pad), 0);
    if (voiceCount === 0) return null;

    /* The note a pad plays is the config's arithmetic, `padNoteStart + pad - 1`
     * — the same one movy's drum grid uses. Without a start note there is no
     * note to declare, and a voice level with no note is not a voice at all, so
     * there is nothing here worth publishing. */
    const start = cfg!.drum && cfg!.drum.padNoteStart;
    if (!Number.isFinite(start as number)) return null;

    const levels: Record<string, any> = {};
    const nav: { label: string; level: string }[] = [];
    const taken = new Set<string>(['root']);

    banks.forEach((bank, i) => {
        /* THE LEVEL KEY IS AN IDENTITY, not chrome: `focusVoice` matches a voice
         * to its page by level, so two banks named alike collapsing into one
         * level would silently open the first bank's page for the second's pad. */
        let key = slug(bank.name);
        while (taken.has(key)) key += '_';
        taken.add(key);

        const keys = keysOf(bank);
        const level: any = { name: bank.name, params: keys, knobs: keys };
        /* A note is what makes a level a VOICE — 9W9's Reverb and Delay are
         * pages precisely because they declare none (voices.mjs). Only the
         * leading run gets one; a `pad` on a later bank is an ordinary page,
         * which is the rule buildRotation just applied. */
        if (i < voiceCount) level.note = (start as number) + (bank.pad as number) - 1;
        levels[key] = level;
        nav.push({ label: bank.name, level: key });
    });

    /* Root is a signpost and nothing else. Its nav links are what page_plan
     * walks, in array order, so THIS is the jog order — the bank order movy
     * already draws. It carries no knobs, and the planner drops a knobs page
     * whose every slot is empty, so root costs no jog step of its own. */
    levels.root = { name: (cfg!.name || cfg!.id || 'Module'), params: nav, knobs: [] };

    /* Declared, never inferred (voices.mjs): movy is stating on the config's
     * behalf that this is a rack. It is also what lights Schwung's pad icon for
     * the voice a page edits. */
    return { pad_layout: 'drums', levels };
}
