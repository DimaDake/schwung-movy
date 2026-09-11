/* What the Settings page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so the
 * list can be asserted in a logic test without a framebuffer. */

import { flagNormalized, flagValueLabel, type FlagDef } from './flags-def.js';
import { visibleFlags } from './flags-visible.js';
import { flagValue } from './flags.js';
import { ACTION_ROWS, flagsPageState } from './flags-page.js';
import { migrateRowArmed, disarmMigrateRow } from './migrate-action.js';

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
        hint: action >= 0 ? ACTION_ROWS[action].hint : (def ? def.hint : ''),
        /* Dark on an action row: knob 1 does nothing there, and a lit knob
         * inviting a turn that changes nothing is worse than an unlit one. */
        knobNormalized: def ? flagNormalized(def, flagValue(def.key)) : 0,
    };
}
