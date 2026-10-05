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
 * WHERE IT APPLIES (user's ruling, 2026-10-05). A rack movy has a config for
 * is planned from that config unless the module declares its rack the MODERN
 * way (`declaresModernRack`). The older drum modules — forge, mrdrums,
 * weird-dreams, signal, libpo32 — publish a contract with no per-pad surface in
 * it (forge's voice levels address `{key}`, i.e. the module's own focus), and
 * they play better from movy's curated banks. A module that DOES declare its
 * pads (simian, dr32, sophie, 6w6/9w9's `pad_layout`) keeps its own pages. A
 * config that describes no rack (a synth's) is never translated, so it never
 * outvotes anything. The caller is renderer/schwung-page-hierarchy.
 *
 * PURE, AND FREE OF SCHWUNG. Plain config in, plain object out: `model/` may not
 * import `renderer/`, and this has to be testable without a schwung checkout —
 * the same rule drum-declared.ts follows for the opposite direction of travel.
 */
import type { ModuleConfig, BankConfig, KnobSlot } from '../types/param.js';
import { buildRotation } from './page-rotation.js';
import { vizOf } from './config-viz.js';

/** A level key movy invents, from the bank name the user already sees. */
function slug(name: string): string {
    return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'bank';
}

/** The slots a bank draws, with the row padding dropped. A config pads its rows
 *  with nulls to fill a page (config-pages.ts does the same downstream); a null
 *  is not a parameter, and a level claiming one plans an empty cell. */
function slotsOf(bank: BankConfig): { slot: KnobSlot; row: number }[] {
    const out: { slot: KnobSlot; row: number }[] = [];
    (bank.rows || []).forEach((row, r) => {
        for (const slot of row || []) if (slot && slot.key) out.push({ slot, row: r });
    });
    return out;
}

/** A slot as a Schwung inline param entry.
 *
 *  INLINE BECAUSE AN ALIAS IS DECLARED NOWHERE ELSE. forge's 43 `cv_*`, libpo32's
 *  `v_*`, mrdrums' `pad_*` have no `chain_params` entry (SP-21's audit), so
 *  without this the planner guesses a 0..1 float and an enum turns into a bare
 *  knob. Schwung's metaIndex lets a real `chain_params` entry win over an inline
 *  one, so a key the module does declare keeps the module's metadata. */
function paramOf(slot: KnobSlot, group: string): Record<string, unknown> {
    const p: Record<string, unknown> = { key: slot.key, type: slot.type };
    const label = slot.full || slot.short;
    if (label) p.label = label;
    if (slot.options) p.options = slot.options;
    if (slot.min !== undefined) p.min = slot.min;
    if (slot.max !== undefined) p.max = slot.max;
    if (slot.step !== undefined) p.step = slot.step;
    if (slot.uiType) p.ui_type = slot.uiType;
    if (slot.filepathParam) p.filepath_param = slot.filepathParam;
    if (slot.fileRoot) p.root = slot.fileRoot;
    if (slot.fileFilter) p.filter = slot.fileFilter;
    if (slot.fileStartPath) p.start_path = slot.fileStartPath;
    const viz = vizOf(slot, group);
    if (viz !== undefined) p.viz = viz;
    return p;
}

/** A config that edits the focused pad through alias keys or a focus param —
 *  forge, mrdrums, weird-dreams, signal, libpo32, sophie. A raw-MIDI note map
 *  (krautdrums, essaim, slicer) has no per-pad pages to give. */
function isPadScopedRack(cfg: ModuleConfig): boolean {
    const d = cfg.drum;
    return !!d && !d.rawMidi && !!(d.padScoping || d.currentPadParam);
}

/**
 * The Schwung hierarchy a movy config describes, or null when it describes no
 * rack — which is most configs, and must stay null so nothing starts planning
 * voice pages for a synth (nor outvotes a synth's own declaration).
 *
 * Two rack shapes. A SIBLING rack (6w6/8w8/9w9/cw78) has a voice run, and its
 * leading banks become voice levels with a note each. A PAD-SCOPED rack (forge,
 * mrdrums, ...) has one set of banks that edits whichever pad is focused; its
 * banks become plain pages, and movy's seam resolves each alias at movy's pad
 * (schwung-page-focus `ioKey`), exactly as MOVY mode's config pages do.
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
    if (voiceCount === 0) return isPadScopedRack(cfg!) ? padScopedHierarchy(cfg!, banks) : null;

    /* The note a pad plays is the config's arithmetic, `padNoteStart + pad - 1`
     * — the same one movy's drum grid uses. Without a start note there is no
     * note to declare, and a voice level with no note is not a voice at all, so
     * there is nothing here worth publishing. */
    const start = cfg!.drum && cfg!.drum.padNoteStart;
    if (!Number.isFinite(start as number)) return null;

    /* A note is what makes a level a VOICE — 9W9's Reverb and Delay are pages
     * precisely because they declare none (voices.mjs). Only the leading run
     * gets one; a `pad` on a later bank is an ordinary page, which is the rule
     * buildRotation just applied. */
    const levels = levelsOf(cfg!, banks, (bank, i) =>
        i < voiceCount ? (start as number) + (bank.pad as number) - 1 : undefined);

    /* Declared, never inferred (voices.mjs): movy is stating on the config's
     * behalf that this is a rack. It is also what lights Schwung's pad icon for
     * the voice a page edits. */
    return { pad_layout: 'drums', levels };
}

function levelOf(bank: BankConfig): any {
    const slots = slotsOf(bank);
    const level: any = {
        name: bank.name,
        params: slots.map((x) => paramOf(x.slot, bank.name + ':' + x.row)),
        knobs: slots.map((x) => x.slot.key),
    };
    /* movy's own mark, for movy's header: the bank re-targets with the focused
     * pad, which is what the pad icon says. Schwung's planner ignores a level
     * field it does not know, and a pad-scoped rack has no voices for the
     * seat to answer from. */
    if (bank.padSpecific) level[PAD_SCOPED_FIELD] = true;
    return level;
}

/** The level field marking a translated bank as per-pad (`bank.padSpecific`). */
export const PAD_SCOPED_FIELD = 'movy_pad_scoped';

/* Root is a signpost and nothing else. Its nav links are what page_plan walks,
 * in array order, so THIS is the jog order — the bank order movy already draws.
 * It carries no knobs, and the planner drops a knobs page whose every slot is
 * empty, so root costs no jog step of its own. */
function rootOf(cfg: ModuleConfig, nav: { label: string; level: string }[]): any {
    return { name: (cfg.name || cfg.id || 'Module'), params: nav, knobs: [] };
}

/** A pad-scoped rack's banks as plain pages, in bank order. No `pad_layout` and
 *  no notes: the config, not this contract, decides the pads (D4), and a voice
 *  here would seat a rack the config does not describe. */
function padScopedHierarchy(cfg: ModuleConfig, banks: BankConfig[]): any {
    return { levels: levelsOf(cfg, banks, () => undefined) };
}

/** One level per bank, plus root. */
function levelsOf(cfg: ModuleConfig, banks: BankConfig[],
                  noteOf: (bank: BankConfig, i: number) => number | undefined): Record<string, any> {
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
        const level = levelOf(bank);
        const note = noteOf(bank, i);
        if (note !== undefined) level.note = note;
        levels[key] = level;
        nav.push({ label: bank.name, level: key });
    });
    levels.root = rootOf(cfg, nav);
    return levels;
}
