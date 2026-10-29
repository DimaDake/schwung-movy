/* SPARSE (user, 2026-10-29: "I like the rhythmic pattern but I want it to
 * play only periodically … musical not random"): the part plays its pattern
 * only in some of the metre's windows. It never rewrites the pattern and
 * draws no dice: a position is a fixed rule over beats or bars, and a kept
 * hit keeps its pitch, voicing and length (the feel row set them against the
 * whole pattern). Only the generators with no density control of their own
 * have it, in DYNAMICS' place.
 *
 * A hit's window is its beat on the grid, before swing, and the 16th before a
 * beat leads into it: a pickup plays with the beat it picks up.
 *
 * Each kind has its own ladder (user: "beat 3 only makes sense for chords
 * only"): a chord part may play any beat, since a chord on a weak beat still
 * says the harmony; a line keeps beat 1 and the first hit of every new chord,
 * so its root under each change always sounds; a pad, one chord a bar, only
 * thins by bars.
 *
 * Its positions are never judged by create/checks.ts: those judge rolled
 * takes, and SPARSE has no roll, so a take always plays everything. A turn
 * past the part's usual busyness is the user's choice. */

import type { GenCtx } from '../analysis/context.js';
import type { KnobDef } from '../knobs.js';
import { sameChord } from '../theory/pc.js';
import { type Ev, TPS } from '../types.js';
import { chordUnder } from './common.js';

export type SparseKind = 'chord' | 'line' | 'pad';

/* `near`: the beats of the bar a chord window wants; a bar that has no hit
 * there plays its hit nearest that beat instead, within an 8th of it. */
interface Win { name: string; on: (beat: number) => boolean; near?: number[] }

const inBar = (name: string, ks: number[]): Win => ({ name, on: (b) => ks.includes(b % 4), near: ks });
/* k beats spread as evenly as n allow (3 in 8 is the tresillo). */
function spread(k: number, n: number): Win {
    const hit = new Set(Array.from({ length: k }, (_, i) => Math.ceil((i * n) / k)));
    return { name: `${k} IN ${n}`, on: (b) => hit.has(b % n) };
}

function build(kind: SparseKind, len: number): Win[] {
    const beats = Math.ceil(len / 4), bars = Math.ceil(len / 16);
    const out: Win[] = [{ name: 'ALL', on: () => true }];
    if (kind === 'chord') {
        out.push(inBar('1+3', [0, 2]), inBar('2+4', [1, 3]), ...[0, 1, 2, 3].map((k) => inBar(`BEAT ${k + 1}`, [k])));
        if (beats >= 8) out.push(spread(3, 8));
        if (beats >= 16) out.push(spread(5, 16));
    }
    if (kind === 'line') {
        /* No "beat 1 every other bar": a chord a bar puts every downbeat back. */
        out.push(inBar('1+3', [0, 2]), inBar('1+4', [0, 3]), inBar('BEAT 1', [0]));
    }
    if (bars >= 2) out.push({ name: 'BAR 1 OF 2', on: (b) => Math.floor(b / 4) % 2 === 0 });
    if (bars >= 4) out.push({ name: 'BAR 1 OF 4', on: (b) => Math.floor(b / 4) % 4 === 0 });
    if (bars >= 2) {
        const g = Math.min(4, bars);
        out.push({ name: 'LAST BAR', on: (b) => Math.floor(b / 4) % g === g - 1 });
    }
    return out;
}

/* The knob's label is read every tick while it is held: build each ladder once. */
const cache = new Map<string, Win[]>();
function ladder(kind: SparseKind, len: number): Win[] {
    const key = kind + len;
    let w = cache.get(key);
    if (!w) { w = build(kind, len); cache.set(key, w); }
    return w;
}

export const sparseKnob = (kind: SparseKind): KnobDef => ({ name: 'SPARSE', steps: (c) => ladder(kind, c.len).length,
    def: () => 0, label: (v, c) => ladder(kind, c.len)[v]?.name ?? 'ALL' });

/** The events SPARSE position `v` keeps; `at` is each event's tick before
 *  swing, `h` the part's harmony. */
export function sparse(ctx: GenCtx, evs: Ev[], at: Map<Ev, number>, kind: SparseKind, v: number, h: number): Ev[] {
    const w = ladder(kind, ctx.len)[v];
    if (!w || v === 0 || !evs.length) return evs;
    const steps = evs.map((e) => Math.round((at.get(e) ?? e.tick) / TPS));
    const beats = steps.map((s) => Math.floor(((s + 1) % ctx.len) / 4));
    const keep = new Set(evs.map((_, i) => i).filter((i) => w.on(beats[i])));
    if (kind === 'line') {
        const ch = evs.map((e) => chordUnder(ctx, h, at.get(e) ?? e.tick));
        ch.forEach((c, i) => { if (!sameChord(c, ch[(i + ch.length - 1) % ch.length])) keep.add(i); });
    }
    if (kind === 'chord' && w.near) {
        for (let bar = 0; bar * 16 < ctx.len; bar++) {
            for (const k of w.near) {
                const b = bar * 4 + k;
                if (beats.includes(b)) continue;
                let best = -1;
                steps.forEach((s, i) => { if (Math.abs(s - b * 4) <= 2 && (best < 0 || Math.abs(s - b * 4) < Math.abs(steps[best] - b * 4))) best = i; });
                if (best >= 0) keep.add(best);
            }
        }
    }
    /* A window this part never plays in leaves it as it is, not silent. */
    return keep.size ? evs.filter((_, i) => keep.has(i)) : evs;
}
