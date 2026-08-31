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

/** `flags` is a parameter so the release arrangement can be rendered from a
 *  build that has the debug surfaces compiled in — otherwise what ships is the
 *  one list no screenshot can see. */
export function buildFlagsPageVM(flags: FlagDef[] = visibleFlags()): FlagsPageVM {
    const sel = Math.max(0, Math.min(flags.length - 1, flagsPageState.selected));
    const rows: FlagRow[] = flags.map((f, i) => ({
        name: f.name,
        value: flagValueLabel(f, flagValue(f.key)),
        selected: i === sel,
    }));
    const def = flags[sel];
    return {
        rows,
        selected: sel,
        hint: def ? def.hint : '',
        knobNormalized: def ? flagNormalized(def, flagValue(def.key)) : 0,
    };
}
