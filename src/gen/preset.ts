/* The preset contract (design §4): each preset is a generator of its own,
 * with four or eight knobs of its own. */

import type { GenCtx } from './analysis/context.js';
import type { KnobDef } from './knobs.js';
import type { GenLevel, Note, PresetClass, RoleKind, Task } from './types.js';

export interface Preset {
    id: string;
    name: string;               // short, for the screen
    task: Task;
    drum: boolean;
    roles?: RoleKind[];         // melodic roles served; absent = every melodic role
    cls: PresetClass;
    /** New Clip on drums: writes only `ctx.pad` (ai/preview-pads.ts). */
    perPad?: boolean;
    knobs: KnobDef[];           // four or eight
    /** Whether this part is material the preset can work with at all (a
     *  harmonised line needs a line that already plays two notes at times). */
    accepts?: (ctx: GenCtx) => boolean;
    /** How suited this preset is to this part, 0..1 (default 0.5). */
    fit?: (ctx: GenCtx) => number;
    /** The new part. `seed` already mixes the request, the preset and any retry. */
    generate: (ctx: GenCtx, v: number[], seed: number) => Note[];
}

export function serves(p: Preset, ctx: GenCtx): boolean {
    if (p.task !== ctx.task || p.drum !== ctx.drum) return false;
    if (p.accepts && !p.accepts(ctx)) return false;
    if (ctx.drum || ctx.task === 'create') return true;
    const kind = ctx.role?.kind;
    return !p.roles || (kind !== undefined && p.roles.includes(kind));
}

/* The level moves every preset's intensity, not only which presets are
 * offered: SAFE rewrites less and stays on chord tones, WILD rewrites more,
 * reaches further in colour and, where the scene is free, in harmony. */
const LEVEL_SHIFT: Record<string, Partial<Record<GenLevel, number>>> = {
    AMOUNT: { SAFE: -2, WILD: 2 },
    TENSION: { SAFE: -1, WILD: 2 },
    HARMONY: { WILD: 1 },
    LIKENESS: { SAFE: 2, WILD: -3 },
    LOCK: { SAFE: 2, WILD: -3 },
    ENDING: { SAFE: -1, WILD: 1 },
    SEAMS: { WILD: 1 },
};

export function defaults(p: Preset, ctx: GenCtx): number[] {
    const level = ctx.input.level;
    return p.knobs.map((k) => {
        let d = k.def(ctx);
        const shift = LEVEL_SHIFT[k.name]?.[level] ?? 0;
        if (shift && !(k.name === 'HARMONY' && ctx.freedom !== 'free')) d += shift;
        return Math.max(0, Math.min(k.steps(ctx) - 1, d));
    });
}

/** Knob index by name, for generators that read their own knobs by name. */
export function knobIndex(p: Preset, name: string): number { return p.knobs.findIndex((k) => k.name === name); }
