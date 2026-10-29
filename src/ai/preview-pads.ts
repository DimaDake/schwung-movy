/* New Clip's per-pad drum options (plans/2026-10-28-new-clip-design.md): an
 * option writes only the selected pad, and pressing another pad adds that
 * pad's notes at the same knobs while the pads already written stay. Each
 * pad keeps its own knobs; DENSITY (knob 1) is the pad's across the per-pad
 * options, so moving between them keeps how busy each pad is. */

import { regenerate } from '../gen/engine.js';
import type { GenCtx } from '../gen/analysis/context.js';
import type { Preset } from '../gen/preset.js';
import type { Note } from '../gen/types.js';
import { padOf } from '../gen/presets/new-drums-pad.js';

export interface PadState { pads: Map<number, { knobs: number[]; notes: Note[] }>; pad: number }
export interface PadOpt { preset: Preset; knobs: number[]; per?: PadState }

let density = new Map<number, number>();

/* A new map, never a clear: a parked session (preview.ts) keeps the old one. */
export function padsReset(): void { density = new Map(); }
export function padsSave(): Map<number, number> { return density; }
export function padsRestore(d: Map<number, number>): void { density = d; }

const make = (ctx: GenCtx, o: PadOpt, pad: number, knobs: number[]): Note[] =>
    regenerate({ ...ctx, pad }, o.preset, knobs) ?? [];

export function padsUnion(o: PadOpt): Note[] {
    return [...o.per!.pads.values()].flatMap((e) => e.notes).sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

/** A per-pad option as it opens: its default is the opening pad's part. */
export function padsOpen(ctx: GenCtx, o: PadOpt, notes: Note[]): void {
    if (!o.preset.perPad) return;
    const pad = padOf(ctx);
    o.per = { pads: new Map([[pad, { knobs: [...o.knobs], notes }]]), pad };
}

/** The option comes on screen: every pad touched so far, at its DENSITY.
 *  true when its notes changed. */
export function padsShow(ctx: GenCtx, o: PadOpt): boolean {
    if (!o.per) return false;
    if (!density.has(o.per.pad)) density.set(o.per.pad, o.knobs[0]);
    let changed = false;
    for (const [pad, d] of density) {
        const e = o.per.pads.get(pad);
        if (e && e.knobs[0] === d) continue;
        const knobs = e ? [d, ...e.knobs.slice(1)] : [d, ...o.knobs.slice(1)];
        o.per.pads.set(pad, { knobs, notes: make(ctx, o, pad, knobs) });
        changed = true;
    }
    o.knobs = [...o.per.pads.get(o.per.pad)!.knobs];
    return changed;
}

/** Another pad pressed: its knobs come up, and it is written if it was not. */
export function padsSelect(ctx: GenCtx, o: PadOpt, pad: number): boolean {
    const per = o.per;
    if (!per || pad === per.pad || !ctx.kit?.pads.includes(pad)) return false;
    per.pad = pad;
    const e = per.pads.get(pad);
    if (e) { o.knobs = [...e.knobs]; return false; }
    const knobs = [density.get(pad) ?? o.knobs[0], ...o.knobs.slice(1)];
    density.set(pad, knobs[0]);
    per.pads.set(pad, { knobs, notes: make(ctx, o, pad, knobs) });
    o.knobs = [...knobs];
    return true;
}

/** A knob turned: only the selected pad is made again. */
export function padsTurn(ctx: GenCtx, o: PadOpt): void {
    const per = o.per!;
    density.set(per.pad, o.knobs[0]);
    per.pads.set(per.pad, { knobs: [...o.knobs], notes: make(ctx, o, per.pad, o.knobs) });
}

/** The clip's length changed: every pad again at its own knobs. */
export function padsRemake(ctx: GenCtx, o: PadOpt): Note[] {
    for (const [pad, e] of o.per!.pads) e.notes = make(ctx, o, pad, e.knobs);
    return padsUnion(o);
}
