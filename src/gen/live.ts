/* Which of an option's knobs can change it, for this part (design §5.1):
 * SWING on a pad that only plays on the beat, or POCKET in a scene whose
 * tracks sit exactly on the grid, cannot. Such a knob is hidden — it shows
 * nothing and does nothing — so no knob on screen is ever dead. Decided by
 * trying the knob's two ends, the only test that cannot disagree with what a
 * turn would do. */

import type { GenCtx } from './analysis/context.js';
import { generateOption } from './generate.js';
import type { Preset } from './preset.js';
import type { Note } from './types.js';

const sig = (a: Note[] | null) => (a ? a.map((n) => `${n.tick}.${n.pitch}.${n.gate}.${n.vel}`).join(',') : '-');

export function knobLive(ctx: GenCtx, p: Preset, v: number[], i: number): boolean {
    const steps = p.knobs[i].steps(ctx);
    if (steps <= 1) return false;
    const seen = new Set<string>();
    /* Where it sits, both ends, the middle and the quarters: a knob that only
     * changes things part way (a locked HARMONY on a drone) is still live. A
     * live knob almost always answers on the second try. */
    const m = steps - 1;
    for (const pos of [v[i], v[i] === 0 ? m : 0, v[i] === m ? 0 : m, Math.round(m / 2), Math.round(m / 4), Math.round((3 * m) / 4)]) {
        const w = [...v];
        w[i] = pos;
        seen.add(sig(generateOption(ctx, p, w).notes));
        if (seen.size > 1) return true;
    }
    return false;
}
