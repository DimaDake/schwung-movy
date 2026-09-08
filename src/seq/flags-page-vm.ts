/* What the Settings page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so the
 * list can be asserted in a logic test without a framebuffer. */

import { flagNormalized, flagValueLabel, type FlagDef } from './flags-def.js';
import { visibleFlags } from './flags-visible.js';
import { flagValue } from './flags.js';
import { flagsPageState } from './flags-page.js';

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

/* The one row on this page that is not a flag: it opens the backups list rather
 * than holding a value. It is drawn from here — and that is the whole point of
 * the assertion in the flags suite that `rows.length` equals `flagsRowCount()`.
 * The first version of this feature added the row to the JOG's clamp and to the
 * router and not to this list, so it was selectable, clickable, and invisible;
 * every screenshot stayed byte-identical because the viewmodel never changed. */
const BACKUPS_NAME = 'BACKUPS';
const BACKUPS_VALUE = '>';
const BACKUPS_HINT = 'Older versions of this set. Restore one.';

/** `flags` is a parameter so the release arrangement can be rendered from a
 *  build that has the debug surfaces compiled in — otherwise what ships is the
 *  one list no screenshot can see. */
export function buildFlagsPageVM(flags: FlagDef[] = visibleFlags()): FlagsPageVM {
    /* One past the flags: the action row is always last, so it never moves when
     * the list differs between debug and release builds. */
    const count = flags.length + 1;
    const sel = Math.max(0, Math.min(count - 1, flagsPageState.selected));
    const onAction = sel === flags.length;
    const rows: FlagRow[] = flags.map((f, i) => ({
        name: f.name,
        value: flagValueLabel(f, flagValue(f.key)),
        selected: i === sel,
    }));
    rows.push({ name: BACKUPS_NAME, value: BACKUPS_VALUE, selected: onAction });
    const def = onAction ? null : flags[sel];
    return {
        rows,
        selected: sel,
        hint: onAction ? BACKUPS_HINT : (def ? def.hint : ''),
        /* Dark on the action row: knob 1 does nothing there, and a lit knob
         * inviting a turn that changes nothing is worse than an unlit one. */
        knobNormalized: def ? flagNormalized(def, flagValue(def.key)) : 0,
    };
}
