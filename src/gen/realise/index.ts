/* Realise: a part's events over the plan's chords, by the part's role. Lines
 * stay lines, chords stay chords (the role rule), a bass lands on roots. */

import type { GenCtx } from '../analysis/context.js';
import type { Ev } from '../types.js';
import { realiseChords } from './chords.js';
import { realiseLine } from './line.js';
import type { RealiseOpts } from './common.js';

export { type RealiseOpts, DEFAULT_TENSION } from './common.js';

export function realise(ctx: GenCtx, evs: Ev[], o: RealiseOpts): Ev[] {
    if (ctx.drum || !evs.length) return evs;
    const kind = ctx.role?.kind;
    if (kind === 'pad' || kind === 'stabs') return realiseChords(ctx, evs, o);
    return realiseLine(ctx, evs, o, kind === 'bass');
}
