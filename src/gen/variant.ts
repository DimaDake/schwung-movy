/* A second take of a preset, its feel moved (user, 2026-10-27: the options
 * should vary more, "all kinds of parameters, rhythmic, notes"): RHYTHM to a
 * new figure, VOICES up, LENGTH and DENSITY the other way, CHANGES on. The
 * selector weighs it against the default take for how much it adds. */

import type { GenCtx } from './analysis/context.js';
import type { Preset } from './preset.js';
import { RHYTHMS } from './shape/rhythm.js';

/* A double's own choices (dbl-*.ts): a take tries the next one along. */
const DOUBLE_CYCLE = ['APPROACH', 'RATE', 'DIRECTION', 'NOTES', 'LAND', 'PUSH', 'STEP', 'FROM', 'KIND', 'PICKUP', 'MOVE',
    'PADS', 'GRAIN', 'KEEP'];

/** Take `which` (0 or 1) of a preset's feel moved; the two go opposite
 *  ways (longer and denser, or shorter, sparser, wider and louder), so the
 *  selector has contrast to choose from. null when no knob of it moves. */
export function variantKnobs(p: Preset, ctx: GenCtx, base: number[], seed: number, which = 0): number[] | null {
    const v = [...base];
    let moved = false;
    const up = which === 0 ? 1 : -1;
    p.knobs.forEach((k, i) => {
        const steps = k.steps(ctx);
        const set = (x: number) => { const y = Math.max(0, Math.min(steps - 1, x)); if (y !== v[i]) { v[i] = y; moved = true; } };
        /* A cycle is a variation's move: Smart Quantize keeps its bar. */
        const rhythms = ctx.task === 'quantize' ? RHYTHMS.indexOf('CYCLE 3') : steps;
        if (k.name === 'RHYTHM' && v[i] === 0) set(1 + ((seed + which * 3) % (rhythms - 1)));
        else if (k.name === 'VOICES') set(v[i] + up);
        else if (k.name === 'LENGTH') set(v[i] + 2 * up);
        else if (k.name === 'DENSITY') set(v[i] + 2 * up);
        else if (k.name === 'CHANGES' && ctx.freedom !== 'locked') set(v[i] + 1 + which);
        else if (k.name === 'DYNAMICS') set(v[i] + 4 + 3 * which);
        else if (which === 1 && k.name === 'RANGE') set(v[i] + 3);
        else if (which === 1 && k.name === 'TENSION') set(v[i] + 2);
        else if (which === 1 && k.name === 'AMOUNT') set(v[i] + 3);
        else if (['EMBELLISH', 'GHOSTS', 'COUNT'].includes(k.name)) set(v[i] + 3 * (which + 1));
        else if (k.name === 'FILL' || k.name === 'SIZE') set(v[i] + 1 + which);
        else if (k.name === 'GRID' && which === 1) set(v[i] === 2 ? 3 : 2);
        else if (k.name === 'FEEL') set((v[i] + 2 + which) % steps);
        else if (k.name === 'PITCH FIX' && which === 0) set(v[i] + 4);
        else if (k.name === 'LIKENESS' || k.name === 'LOCK') set(v[i] - 2 - 2 * which);
        else if (k.name === 'LOOP') set(v[i] + (which ? -2 : 1));
        else if (k.name === 'PHRASE' && which === 1) set(v[i] + 1);
        else if (k.name === 'FORM' || k.name === 'ANSWER') set((v[i] + 1 + which) % steps);
        else if (k.name === 'X') set(v[i] + (which ? 6 : 3));
        else if (k.name === 'Y') set(v[i] + (which ? 2 : 5));
        else if (k.name === 'ENDING') set(v[i] + (which ? -1 : 1));
        else if (k.name === 'SEAMS' && which === 1) set(1 - v[i]);
        else if (ctx.task === 'double' && DOUBLE_CYCLE.includes(k.name)) set((v[i] + 1 + which) % steps);
    });
    return moved ? v : null;
}
