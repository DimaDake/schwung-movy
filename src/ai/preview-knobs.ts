/* The preview's knobs (plans/2026-10-27-algorithmic-generators-design.md §5): the option on
 * screen's, of its preset. A turn regenerates it and writes it over the clip (hand edits
 * on it discarded, by design); a touch shows name and value in the top strip, as a Schwung
 * page does. A knob that cannot change this option is hidden (gen/live.ts); ORIG has none. */

import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { regenerate } from '../gen/engine.js';
import { knobLive } from '../gen/live.js';
import { probeStep } from './knob-probe.js';
import { slotKnob } from '../gen/layout.js';
import { seedForget, seedLabel, seedPos, seedTick, seedTurn } from './preview-seed.js';
import type { GenCtx } from '../gen/analysis/context.js';
import type { Preset } from '../gen/preset.js';
import type { Note } from '../gen/types.js';
import { seqHeaderAnnounce } from '../seq/render.js';
import { countDetents } from '../seq/detent.js';
import { type PadState, type PadsStep, padsApply, padsOpen, padsReset, padsRestore, padsSave, padsSnapshot, padsTick, padsTurn, padsUnion, padsRemake } from './preview-pads.js';

interface Opt { preset: Preset; knobs: number[]; live: (boolean | undefined)[]; per?: PadState; own?: GenCtx /* made in its own context (Step 14's New Clip) */ }

/* Seen for about a second after the last touch or turn (render.ts toasts). */
const STRIP_TTL = 196;

let ctx: GenCtx | null = null;
let opts: Opt[] = [];
let shown = 0;              // 0 = ORIG
let pending = false;
let held = -1;              // the touched knob, -1 none
let resync = false;         // a per-pad option came on screen: its pads to catch up
const accum: number[] = []; // raw knob units banked toward the next step
let turned = -1;            // ticks since a gesture's last regeneration, -1 none: its end is an undo step
let onStep: (() => void) | null = null;
export function knobsOnStep(f: (() => void) | null): void { onStep = f; }
const stepEnds = () => { turned = -1; onStep?.(); };

export function knobsOpen(c: GenCtx, picks: { preset: Preset; knobs: number[]; ctx?: GenCtx }[], notes: Note[][] = []): void {
    ctx = c;
    padsReset();
    opts = picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs], live: p.knobs.map(() => undefined), ...(p.ctx ? { own: p.ctx } : {}) }));
    opts.forEach((o, i) => padsOpen(c, o, notes[i] ?? []));
    resync = true;
    shown = 1;
    pending = false;
    held = -1; turned = -1;
    accum.length = 0;
}

/** A parked session's knobs (preview.ts): everything a resume needs back,
 *  including a turn not yet regenerated. */
export interface KnobsSnap { ctx: GenCtx | null; opts: Opt[]; shown: number; pending: boolean; density: Map<number, number> }

export function knobsSave(): KnobsSnap { return { ctx, opts, shown, pending, density: padsSave() }; }

export function knobsRestore(s: KnobsSnap): void {
    ({ ctx, opts, shown, pending } = s);
    padsRestore(s.density); held = -1; resync = true; accum.length = 0;
}

export function knobsReset(): void { ctx = null; opts = []; pending = false; held = -1; shown = 0; resync = false; turned = -1; padsReset(); }

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

/* Hardware knobs are slots (gen/layout.ts); -1 where a slot is dark. */
const knobAt = (o: Opt | undefined, s: number): number => (o ? slotKnob(o.preset, s) ?? -1 : -1);

function current(i: number): Opt | null {
    const o = opts[shown - 1];
    if (!ctx || !o || i < 0 || i >= o.preset.knobs.length) return null;
    if (o.live[i] === undefined) o.live[i] = knobLive(cx(o), o.preset, o.knobs, i);
    return o.live[i] ? o : null;
}

const cx = (o: Opt): GenCtx => o.own ?? ctx!;
const valueOf = (o: Opt, i: number): string => (o.preset.knobs[i].seed ? seedLabel(o, i) : o.preset.knobs[i].label(o.knobs[i], cx(o)));

function strip(o: Opt, i: number): void {
    seqHeaderAnnounce(o.preset.knobs[i].name, STRIP_TTL, valueOf(o, i));
    appState.dirty = true;
}

/** True when the preview owns this knob turn. */
export function knobTurn(slot: number, delta: number): boolean {
    if (!ctx || !opts.length) return false;
    const i = knobAt(opts[shown - 1], slot);
    const o = current(i);
    if (!o || !delta) return true;
    const steps = o.preset.knobs[i].steps(cx(o));
    /* One step per click, as on movy's own stepped pages (seq/detent.ts):
     * a knob sends several raw units per click, and movy-host sums a tick's
     * worth into one turn. The remainder carries to the next turn. */
    const n = countDetents(accum, slot, delta);
    if (o.preset.knobs[i].seed) {
        if (n && seedTurn(cx(o), o, i, n)) { o.live = o.live.map((l, j) => (j === i ? l : undefined)); pending = true; }
        strip(o, i);
        return true;
    }
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

export function knobTouch(slot: number, on: boolean): boolean {
    if (!ctx || !opts.length) return false;
    const i = knobAt(opts[shown - 1], slot);
    if (!on) { if (held === i) held = -1; if (turned >= 0) stepEnds(); return true; }
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
    /* A waiting SEED turn lands once its order is built: the strip says where. */
    if (seedTick(o)) { pending = true; strip(o, o.preset.knobs.findIndex((k) => k.seed)); }
    if (held >= 0) seqHeaderAnnounce(o.preset.knobs[held].name, STRIP_TTL, valueOf(o, held));
    if (o.per) { const wrote = padsTick(ctx, o, resync, write); resync = false; if (wrote === 'pad') stepEnds(); if (wrote) return; }
    if (pending) {
        pending = false;
        if (o.per) { padsTurn(ctx, o); write(padsUnion(o)); turned = 0; appState.dirty = true; return; }
        const notes = regenerate(cx(o), o.preset, o.knobs);
        if (notes) { write(notes); turned = 0; appState.dirty = true; } else mlog(`gen: ${o.preset.id} refused ${o.knobs.join(',')}`);
        return;
    }
    /* A gesture with no touch release ends when the strip times out. */
    if (turned >= 0 && held < 0 && ++turned > STRIP_TTL) stepEnds();
    const u = o.live.findIndex((l) => l === undefined);
    if (u < 0) return;
    const r = probeStep(o, cx(o), o.preset, o.knobs, u);
    if (r !== undefined) { o.live[u] = r; appState.dirty = true; }
}

/** The knob LEDs, like a module's params: each slot's knob of the option showing at its
 *  position (0..1); dark where the slot has none, where it cannot change this option
 *  (or is not known yet to), and on ORIG. null = no preview knobs. */
export function knobLevels(): (number | null)[] | null {
    if (!ctx || !opts.length) return null;
    const o = opts[shown - 1];
    return Array.from({ length: 8 }, (_, s) => {
        const i = knobAt(o, s);
        if (!o || i < 0 || o.live[i] !== true) return null;
        const steps = o.preset.knobs[i].steps(cx(o));
        return steps > 1 ? (o.preset.knobs[i].seed ? seedPos(o, i) : o.knobs[i]) / (steps - 1) : null;
    });
}

/** Test hook: the knob positions of an option (1-based). */
export function knobsOf(index: number): number[] { return opts[index - 1]?.knobs ?? []; }

/** Every option's knob positions and pads, and putting them back (an undo step, preview-undo.ts). */
export interface KnobsStep { knobs: number[][]; pads: PadsStep }
export function knobsSnapshot(): KnobsStep { return { knobs: opts.map((o) => [...o.knobs]), pads: padsSnapshot(opts) }; }
export function knobsApply(k: KnobsStep): void {
    opts.forEach((o, i) => { seedForget(o); if (k.knobs[i]) { o.knobs = [...k.knobs[i]]; o.live = o.live.map(() => undefined); } });
    padsApply(opts, k.pads); pending = false; turned = -1;
}

/** Before an undo: a turn still to be regenerated lands now, and a gesture
 *  in progress ends as its own step. */
export function knobsFlush(write: (notes: Note[]) => void): void {
    if (pending) knobsTick(write);
    if (turned >= 0) stepEnds();
    opts.forEach(seedForget); }   // a SEED turn still waiting for its order never lands after

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

/** The Set moved under a parked session (preview-refresh.ts): later turns
 *  answer the new context; the options as they stand are left alone. */
export function knobsRecontext(c: GenCtx): void {
    ctx = c;
    for (const o of opts) o.live = o.live.map(() => undefined);
    appState.dirty = true; }
