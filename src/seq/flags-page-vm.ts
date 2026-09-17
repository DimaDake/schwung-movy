/* What the Settings page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so the
 * list can be asserted in a logic test without a framebuffer. */

import { flagNormalized, flagValueLabel, type FlagDef } from './flags-def.js';
import { visibleFlags } from './flags-visible.js';
import { flagValue } from './flags.js';
import { ACTION_ROWS, flagsPageState } from './flags-page.js';
import { migrateRowArmed, disarmMigrateRow } from './migrate-action.js';
import { schwungFloorReasonOnce } from '../renderer/schwung-floor.js';

export type FlagRow = { name: string; value: string; selected: boolean };

export type FlagsPageVM = {
    rows: FlagRow[];
    selected: number;
    /** The selected row's one-sentence explanation, for the band at the bottom.
     *  Raw: the renderer owns the wrap, because only it knows the font. */
    hint: string;
    /** 0..1 for the knob-1 LED — the value, so the brightness carries it. */
    knobNormalized: number;
};

/* THE PARAM PAGES ROW IS WHERE THE VERSION FLOOR IS MET, so its hint is where
 * the reason belongs — the ledger's SP-06 asks for exactly this ("an under-floor
 * Schwung pins to MOVY and the Settings hint says which version is needed").
 *
 * It REPLACES the row's own sentence rather than joining it: the band is two
 * lines of 124 px, the standing explanation already fills most of one, and
 * "needs Schwung 1.3.0 (have 1.2.0)" is the half a person can act on. On a
 * device that MEETS the floor the reason is the empty string, so this returns
 * the row's hint character for character and nothing on screen moves.
 *
 * Composed here rather than in the renderer: renderer/ takes a VM and is pure,
 * and `schwungFloorReasonOnce` reads host state — a render function that read
 * it would return different pixels for the same VM, and the row's text could
 * not be asserted without a framebuffer. */
function flagHint(def: FlagDef): string {
    return def.key === 'schwunggrid' ? (schwungFloorReasonOnce() || def.hint) : def.hint;
}

/** `flags` is a parameter so the release arrangement can be rendered from a
 *  build that has the debug surfaces compiled in — otherwise what ships is the
 *  one list no screenshot can see. */
export function buildFlagsPageVM(flags: FlagDef[] = visibleFlags()): FlagsPageVM {
    const count = flags.length + ACTION_ROWS.length;
    const sel = Math.max(0, Math.min(count - 1, flagsPageState.selected));
    /* -1 while a flag is selected; the ACTION_ROWS index otherwise. */
    const action = sel - flags.length;
    /* Building the rows is also where a stale arm expires: the selection has
     * moved off the MIGRATE TRACKS row, and a confirmation the user can no
     * longer see on screen is not one they gave. */
    if (action !== 1) disarmMigrateRow();
    const rows: FlagRow[] = flags.map((f, i) => ({
        name: f.name,
        value: flagValueLabel(f, flagValue(f.key)),
        selected: i === sel,
    }));
    ACTION_ROWS.forEach((a, i) => rows.push({
        name: a.name,
        value: i === 1 && migrateRowArmed() ? 'CONFIRM?' : '>',
        selected: action === i,
    }));
    const def = action >= 0 ? null : flags[sel];
    return {
        rows,
        selected: sel,
        hint: action >= 0 ? ACTION_ROWS[action].hint : (def ? flagHint(def) : ''),
        /* Dark on an action row: knob 1 does nothing there, and a lit knob
         * inviting a turn that changes nothing is worse than an unlit one. */
        knobNormalized: def ? flagNormalized(def, flagValue(def.key)) : 0,
    };
}
