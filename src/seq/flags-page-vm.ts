/* What the Settings page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so the
 * list can be asserted in a logic test without a framebuffer. */

import { ACTION_ROWS, flagsPageState } from './flags-page.js';
import { clickVolumeLabel } from './click-volume.js';
import { genLevelLabel } from './gen-level.js';
import { genModeLabel } from './gen-mode.js';
import { disarmMigrateRow, migrateRowHint, migrateRowValue } from './migrate-action.js';

const rowIndex = (name: string) => ACTION_ROWS.findIndex((r) => r.name === name);
const MIGRATE_ROW = rowIndex('MIGRATE FROM MOVE');
const CLICK_ROW = rowIndex('CLICK VOLUME');
const GEN_ROW = rowIndex('GENERATORS');
const MODE_ROW = rowIndex('GENERATOR MODE');

export type FlagRow = { name: string; value: string; selected: boolean };

export type FlagsPageVM = {
    rows: FlagRow[];
    selected: number;
    /** The selected row's one-sentence explanation, for the band at the bottom.
     *  Raw: the renderer owns the wrap, because only it knows the font. */
    hint: string;
};

export function buildFlagsPageVM(): FlagsPageVM {
    const sel = Math.max(0, Math.min(ACTION_ROWS.length - 1, flagsPageState.selected));
    /* Building the rows is also where a stale arm expires: the selection has
     * moved off the migrate row, and a confirmation the user can no longer
     * see on screen is not one they gave. */
    if (sel !== MIGRATE_ROW) disarmMigrateRow();
    const rows: FlagRow[] = ACTION_ROWS.map((a, i) => ({
        name: a.name,
        value: i === MIGRATE_ROW ? migrateRowValue() : i === CLICK_ROW ? clickVolumeLabel()
            : i === GEN_ROW ? genLevelLabel() : i === MODE_ROW ? genModeLabel() : '>',
        selected: i === sel,
    }));
    return {
        rows,
        selected: sel,
        hint: sel === MIGRATE_ROW ? migrateRowHint() : ACTION_ROWS[sel].hint,
    };
}
