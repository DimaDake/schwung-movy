/* Which of an option's knobs can change it, for this part (design §5.1):
 * SWING on a pad that only plays on the beat, or POCKET in a scene whose
 * tracks sit exactly on the grid, cannot. Such a knob is hidden — it shows
 * nothing and does nothing — so no knob on screen is ever dead. Decided by
 * trying the knob's two ends, the only test that cannot disagree with what a
 * turn would do. */

import type { GenCtx } from './analysis/context.js';
import { RETRIES, rollOption } from './generate.js';
import { drain } from './plan.js';
import type { Preset } from './preset.js';
import type { Note } from './types.js';

const sig = (a: Note[] | null) => (a ? a.map((n) => `${n.tick}.${n.pitch}.${n.gate}.${n.vel}`).join(',') : '-');

/* One option at `v`, a roll a step: a probe is up to six options of eight
 * rolls each, 0.15 s in one device tick on a chord part (2026-11-07). */
function* optionSteps(ctx: GenCtx, p: Preset, v: number[]): Generator<void, Note[] | null, void> {
    const tried = new Set<string>();
    for (let retry = 0; retry < RETRIES; retry++) {
        const r = rollOption(ctx, p, v, retry, tried);
        if (r.notes) return r.notes;
        if (r.end) return null;
        yield;
    }
    return null;
}

export function* knobLiveSteps(ctx: GenCtx, p: Preset, v: number[], i: number): Generator<void, boolean, void> {
    const steps = p.knobs[i].steps(ctx);
    if (steps <= 1) return false;
    const seen = new Set<string>();
    /* Where it sits, both ends, the middle and the quarters: a knob that only
     * changes things part way (a locked HARMONY on a drone) is still live. A
     * live knob almost always answers on the second try. */
    const m = steps - 1;
    const at = [v[i], v[i] === 0 ? m : 0, v[i] === m ? 0 : m, Math.round(m / 2), Math.round(m / 4), Math.round((3 * m) / 4)];
    for (let k = 0; k < at.length; k++) {
        const w = [...v];
        w[i] = at[k];
        const notes = yield* optionSteps(ctx, p, w);
        seen.add(sig(notes));
        if (seen.size > 1) return true;
    }
    return false;
}

export const knobLive = (ctx: GenCtx, p: Preset, v: number[], i: number): boolean => drain(knobLiveSteps(ctx, p, v, i));
