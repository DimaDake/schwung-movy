/* The preview's knobs (plans/2026-10-27-algorithmic-generators-design.md §5):
 * the knobs of the option on screen — of its preset. A turn regenerates that
 * option from its preset at the new positions and writes it over the clip
 * (hand edits on it are discarded, by design); touching a knob shows its name
 * and value in the top strip, the way a Schwung page shows a held knob. A knob
 * that cannot change this option is hidden (gen/live.ts). ORIG has none. */

import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { regenerate } from '../gen/engine.js';
import { knobLive } from '../gen/live.js';
import type { GenCtx } from '../gen/analysis/context.js';
import type { Preset } from '../gen/preset.js';
import type { Note } from '../gen/types.js';
import { seqHeaderAnnounce } from '../seq/render.js';
import { countDetents } from '../seq/detent.js';
import { seqState } from '../seq/state.js';
import { type PadState, padsOpen, padsReset, padsSelect, padsShow, padsTurn, padsUnion, padsRemake } from './preview-pads.js';

interface Opt { preset: Preset; knobs: number[]; live: (boolean | undefined)[]; per?: PadState }

/* Seen for about a second after the last touch or turn (render.ts toasts). */
const STRIP_TTL = 196;

let ctx: GenCtx | null = null;
let opts: Opt[] = [];
let shown = 0;              // 0 = ORIG
let pending = false;
let held = -1;              // the touched knob, -1 none
let resync = false;         // a per-pad option came on screen: its pads to catch up
const accum: number[] = []; // raw knob units banked toward the next step

export function knobsOpen(c: GenCtx, picks: { preset: Preset; knobs: number[] }[], notes: Note[][] = []): void {
    ctx = c;
    padsReset();
    opts = picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs], live: p.knobs.map(() => undefined) }));
    opts.forEach((o, i) => padsOpen(c, o, notes[i] ?? []));
    resync = true;
    shown = 1;
    pending = false;
    held = -1;
    accum.length = 0;
}

export function knobsReset(): void { ctx = null; opts = []; pending = false; held = -1; shown = 0; resync = false; padsReset(); }

/** The jog moved to another option: its own knobs from now on, and its name. */
export function knobsShown(index: number): void {
    shown = index;
    held = -1;
    resync = true;
    accum.length = 0;
    const o = opts[index - 1];
    if (o) { seqHeaderAnnounce(`${index}  ${o.preset.name}`, STRIP_TTL); appState.dirty = true; }
}

/** The preset name of the option showing; '' on ORIG or without knobs. */
export function knobsName(): string { return opts[shown - 1]?.preset.name ?? ''; }

function current(i: number): Opt | null {
    const o = opts[shown - 1];
    if (!ctx || !o || i < 0 || i >= o.preset.knobs.length) return null;
    if (o.live[i] === undefined) o.live[i] = knobLive(ctx, o.preset, o.knobs, i);
    return o.live[i] ? o : null;
}

function strip(o: Opt, i: number): void {
    const k = o.preset.knobs[i];
    seqHeaderAnnounce(k.name, STRIP_TTL, k.label(o.knobs[i], ctx!));
    appState.dirty = true;
}

/** True when the preview owns this knob turn. */
export function knobTurn(i: number, delta: number): boolean {
    if (!ctx || !opts.length) return false;
    const o = current(i);
    if (!o || !delta) return true;
    const steps = o.preset.knobs[i].steps(ctx);
    /* One step per click, as on movy's own stepped pages (seq/detent.ts):
     * a knob sends several raw units per click, and movy-host sums a tick's
     * worth into one turn. The remainder carries to the next turn. */
    const n = countDetents(accum, i, delta);
    const next = Math.max(0, Math.min(steps - 1, o.knobs[i] + n));
    if (next !== o.knobs[i]) {
        o.knobs[i] = next;
        /* What a knob can do depends on where the others sit. */
        o.live = o.live.map((l, j) => (j === i ? l : undefined));
        pending = true;
    }
    strip(o, i);
    return true;
}

export function knobTouch(i: number, on: boolean): boolean {
    if (!ctx || !opts.length) return false;
    if (!on) { if (held === i) held = -1; return true; }
    const o = current(i);
    held = o ? i : -1;
    if (o) strip(o, i);
    return true;
}

/** Per tick: one regeneration for however many detents arrived, the strip
 *  kept up while a knob is held, and one knob of the option showing probed
 *  for whether it can change it (so its LED lights only if it can). */
export function knobsTick(write: (notes: Note[]) => void): void {
    if (!ctx) return;
    const o = opts[shown - 1];
    if (!o) return;
    if (held >= 0) seqHeaderAnnounce(o.preset.knobs[held].name, STRIP_TTL, o.preset.knobs[held].label(o.knobs[held], ctx));
    if (o.per && perPadTick(o, write)) return;
    if (pending) {
        pending = false;
        if (o.per) { padsTurn(ctx, o); write(padsUnion(o)); appState.dirty = true; return; }
        const notes = regenerate(ctx, o.preset, o.knobs);
        if (notes) { write(notes); appState.dirty = true; } else mlog(`gen: ${o.preset.id} refused ${o.knobs.join(',')}`);
        return;
    }
    const u = o.live.findIndex((l) => l === undefined);
    if (u >= 0) { o.live[u] = knobLive(ctx, o.preset, o.knobs, u); appState.dirty = true; }
}

/** The knob LEDs, like a module's params: each knob of the option showing at
 *  its position (0..1); dark where it has none, where it cannot change this
 *  option (or is not known yet to), and on ORIG. null = no preview knobs. */
export function knobLevels(): (number | null)[] | null {
    if (!ctx || !opts.length) return null;
    const c = ctx;
    const o = opts[shown - 1];
    return Array.from({ length: 8 }, (_, i) => {
        if (!o || i >= o.preset.knobs.length || o.live[i] !== true) return null;
        const steps = o.preset.knobs[i].steps(c);
        return steps > 1 ? o.knobs[i] / (steps - 1) : null;
    });
}

/** Test hook: the knob positions of an option (1-based). */
export function knobsOf(index: number): number[] { return opts[index - 1]?.knobs ?? []; }

/* A per-pad option follows the selected pad (preview-pads.ts); true when
 * this tick wrote. */
function perPadTick(o: Opt, write: (notes: Note[]) => void): boolean {
    const c = ctx!;
    const was = o.per!.pad;
    const changed = (resync && padsShow(c, o)) || padsSelect(c, o, seqState.watchLane);
    resync = false;
    if (o.per!.pad !== was) { o.live = o.live.map(() => undefined); appState.dirty = true; }
    if (changed) { write(padsUnion(o)); appState.dirty = true; }
    return changed;
}

/** The clip's length changed under the preview (New Clip): every option made
 *  again from its own knobs in the new context; the options' new notes. */
export function knobsRemake(c: GenCtx): Note[][] {
    ctx = c;
    return opts.map((o) => {
        o.live = o.live.map(() => undefined);
        return o.per ? padsRemake(c, o) : regenerate(c, o.preset, o.knobs) ?? [];
    });
}

export function knobsCtx(): GenCtx | null { return ctx; }
