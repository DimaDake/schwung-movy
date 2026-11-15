/* What the Settings page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so the
 * list can be asserted in a logic test without a framebuffer. */

import { ACTION_ROWS, flagsPageState } from './flags-page.js';
import { clickVolumeDb, clickVolumeLabel } from './click-volume.js';
import { linkSettingLabel, linkSettingOn } from './link-setting.js';
import { CLICK_DB_MAX } from './prefs.js';
import { disarmMigrateRow, migrateRowHint, migrateRowValue } from './migrate-action.js';

const rowIndex = (name: string) => ACTION_ROWS.findIndex((r) => r.name === name);
const MIGRATE_ROW = rowIndex('MIGRATE FROM MOVE');
const CLICK_ROW = rowIndex('CLICK VOLUME');
const LINK_ROW = rowIndex('LINK');

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
            : i === LINK_ROW ? linkSettingLabel() : '>',
        selected: i === sel,
    }));
    return {
        rows,
        selected: sel,
        hint: sel === MIGRATE_ROW ? migrateRowHint() : ACTION_ROWS[sel].hint,
    };
}

/** Knob 1's LED on this page, 0..1 across the selected row's range as on a
 *  parameter page, or null (dark) on a row the knob does not edit. */
export function flagsKnobLevel(): number | null {
    const sel = Math.max(0, Math.min(ACTION_ROWS.length - 1, flagsPageState.selected));
    if (sel === CLICK_ROW) return clickVolumeDb() / CLICK_DB_MAX;
    if (sel === LINK_ROW) return linkSettingOn() ? 1 : 0;
    return null;
}
