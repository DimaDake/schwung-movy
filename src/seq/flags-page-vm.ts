/* What the Global Parameters page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so the
 * list can be asserted in a logic test without a framebuffer. */

import { FLAGS, flagNormalized, flagValueLabel } from './flags-def.js';
import { flagValue } from './flags.js';
import { flagsPageState } from './flags-page.js';

export type FlagRow = { name: string; value: string; selected: boolean };

export type FlagsPageVM = {
    rows: FlagRow[];
    selected: number;
    /** 0..1 for the knob-1 LED — the value, so the brightness carries it. */
    knobNormalized: number;
};

export function buildFlagsPageVM(): FlagsPageVM {
    const sel = Math.max(0, Math.min(FLAGS.length - 1, flagsPageState.selected));
    const rows: FlagRow[] = FLAGS.map((f, i) => ({
        name: f.name,
        value: flagValueLabel(f, flagValue(f.key)),
        selected: i === sel,
    }));
    const def = FLAGS[sel];
    return {
        rows,
        selected: sel,
        knobNormalized: def ? flagNormalized(def, flagValue(def.key)) : 0,
    };
}
