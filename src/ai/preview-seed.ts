/* A SEED knob in the preview (plans/2026-11-01-generator-ux-design.md §2.8):
 * its position is a place in the option's takes ordered close to far
 * (gen/seed-order.ts), not the raw seed. The order is built a take a tick
 * the first time the knob is turned, and again after another knob of the
 * option moved; until then the strip says '...' and the turn waits. */

import type { GenCtx } from '../gen/analysis/context.js';
import type { Preset } from '../gen/preset.js';
import { seedOrder } from '../gen/seed-order.js';

interface Opt { preset: Preset; knobs: number[] }
/* `due`: clicks turned while the order is built, placed from the take's own rank once it is. */
interface State { sig: string; gen: Generator<void, number[], void> | null; order: number[] | null; pos: number; due: number }

const states = new WeakMap<Opt, State>();
const sigOf = (o: Opt, i: number) => o.knobs.map((v, j) => (j === i ? '-' : v)).join();

function stateOf(o: Opt, i: number): State {
    const sig = sigOf(o, i);
    let s = states.get(o);
    if (!s || s.sig !== sig) {
        s = { sig, gen: null, order: null, pos: o.knobs[i], due: 0 };
        states.set(o, s);
    }
    return s;
}

/** A turn of `n` clicks on SEED knob `i`: true when the option's knobs moved now. */
export function seedTurn(ctx: GenCtx, o: Opt, i: number, n: number): boolean {
    const s = stateOf(o, i);
    if (s.order) return place(o, i, s, s.pos + n);
    s.due += n;
    if (!s.gen) s.gen = seedOrder(ctx, o.preset, o.knobs.map((v, j) => (j === i ? 0 : v)), i);
    return false;
}

function place(o: Opt, i: number, s: State, to: number): boolean {
    s.due = 0;
    const pos = Math.max(0, Math.min(s.order!.length - 1, to));
    if (pos === s.pos && o.knobs[i] === s.order![pos]) return false;
    s.pos = pos;
    o.knobs[i] = s.order![pos];
    s.sig = sigOf(o, i);
    return true;
}

/** Per tick: one take of the order, and a waiting turn placed once it is
 *  built. True when the option's knobs moved. */
export function seedTick(o: Opt): boolean {
    const i = o.preset.knobs.findIndex((k) => k.seed);
    const s = i >= 0 ? states.get(o) : undefined;
    if (!s?.gen) return false;
    const r = s.gen.next();
    if (!r.done) return false;
    s.gen = null;
    s.order = r.value;
    const at = s.order.indexOf(o.knobs[i]);
    s.pos = at >= 0 ? at : 0;
    return s.due ? place(o, i, s, s.pos + s.due) : false;
}

/** The SEED knob's value for the strip: its place in the order, or '...' while ordering. */
export function seedLabel(o: Opt, i: number): string {
    const s = states.get(o);
    if (s?.gen) return '...';
    return '#' + ((s && s.sig === sigOf(o, i) && s.order ? s.pos : o.knobs[i]) + 1);
}

/** The SEED knob's position for its LED. */
export function seedPos(o: Opt, i: number): number {
    const s = states.get(o);
    return s && s.order && s.sig === sigOf(o, i) ? s.pos : o.knobs[i];
}
