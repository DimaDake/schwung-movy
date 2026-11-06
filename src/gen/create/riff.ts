/* A bass riff (plans/2026-11-06-bass-over-chords-evaluation.md): what the
 * user's own lines do and the generators did not. A one-bar cell of scale
 * steps from the chord's root, moved with the chords (a held note keeps to
 * chord tones, a short one may step to a neighbour); the answering bar
 * changes one note and walks its last beat into the next root. Shared by New
 * Clip's BASS and Variation's BASSLINE. */

import type { GenCtx } from '../analysis/context.js';
import { pick, type Rng } from '../rng.js';
import { nearestPitch, pc, scaleOf } from '../theory/pc.js';
import { type Chord, TPS } from '../types.js';

export interface Hit { tick: number; pitch: number; gate: number; vel: number }

/** The scale tone `n` steps from `p` (negative: down). */
export function scaleStep(scale: number[], p: number, n: number): number {
    let q = p;
    for (let k = 0; k < Math.abs(n); k++) do q += Math.sign(n); while (!scale.includes(pc(q)));
    return q;
}

/** A step into `next`'s root from near `root`: the scale step below or
 *  above it, else a semitone under it or a tone over. */
export function approachTo(ctx: GenCtx, root: number, next: Chord, r: Rng): number {
    const t = nearestPitch(root, [next.root], root - 6, root + 6);
    const below = r() < 0.6;
    const step = scaleStep(scaleOf(ctx.key), t, below ? -1 : 1);
    if (Math.abs(step - t) <= 2 && r() < 0.6) return step;
    return t + (below ? -1 : 2);
}

/* Offsets in scale steps: 0 the root, 2 the chord's third, 4 its fifth, 7 the
 * octave, ±1 a neighbour. A leap of more than a third comes back to the root
 * or the octave, as the user's lines do. */
const SHORT: [number, number][] = [[0, 2], [1, 2], [-1, 2], [2, 2], [4, 1], [7, 1]];
const HELD: [number, number][] = [[0, 2], [2, 2], [4, 2], [7, 1]];

/** One bar's cell for a figure of [step, length] hits. */
export function riffCell(fig: [number, number][], r: Rng): number[] {
    let prev = 0;
    return fig.map(([s, len], i) => {
        if (i === 0 || (s % 8 === 0 && r() < 0.5)) return (prev = 0);
        /* A repeat is half as likely: the user's lines repeat a note 19% of the time. */
        const opts = (len >= 4 ? HELD : SHORT).map(([o, w]) => [o, (Math.abs(o - prev) > 2 && o !== 0 && o !== 7 ? w * 0.3 : w) * (o === prev ? 0.5 : 1)]);
        let x = r() * opts.reduce((a, [, w]) => a + w, 0);
        const o = opts.find(([, w]) => (x -= w) < 0)?.[0] ?? 0;
        return (prev = o);
    });
}

/** The answering bar's cell: one short note after the first moved a step. */
export function answerCell(cell: number[], fig: [number, number][], r: Rng): number[] {
    const can = cell.map((_, i) => i).filter((i) => i > 0 && fig[i][1] < 4);
    if (!can.length) return cell;
    const j = pick(r, can);
    return cell.map((o, i) => (i === j ? o + (r() < 0.5 ? 1 : -1) : o));
}

/** The pitch an offset plays over `c` with its root at `root`. */
export function riffPitch(ctx: GenCtx, c: Chord, root: number, off: number): number {
    if (off === 0) return root;
    if (off === 7) return root + 12;
    if (off === 2) return nearestPitch(root + 4, c.pcs.slice(1), root + 1, root + 12);
    if (off === 4) return nearestPitch(root + 7, [c.pcs[2] ?? pc(c.root + 7)], root, root + 12);
    return scaleStep(scaleOf(ctx.key), root, off);
}

/* The two-bar phrase's end: the answering bar's last beat walks up or down
 * the scale into the next bar's root. A figure with nothing on the last
 * eighth gets a pickup there, a kick-locked one too (the public parts land
 * on the kick half the time, not always); one with a hit there and none
 * after splits it into two 16ths. Either way the answer has a rhythm of its
 * own: every bar of the generators' lines had played one. */
export function answerBar(ctx: GenCtx, out: Hit[], bar: number, next: Chord, vel: (t: number) => number): void {
    const from = bar * 16 * TPS, tail = from + 12 * TPS, end = from + 16 * TPS, at = from + 14 * TPS;
    const first = out.find((n) => n.tick >= from && n.tick < end);
    if (!first) return;
    if (at < ctx.end && !out.some((n) => n.tick >= at && n.tick < end)) {
        const held = out.filter((n) => n.tick < at && n.tick >= from).pop();
        if (held) held.gate = Math.min(held.gate, at - held.tick - 4);
        out.push({ tick: at, pitch: first.pitch, gate: 2 * TPS - 4, vel: vel(at) });
    } else {
        const hit = out.find((n) => n.tick === at), last = at + TPS;
        if (hit && last < ctx.end && !out.some((n) => n.tick > at && n.tick < end)) {
            hit.gate = Math.min(hit.gate, TPS - 4);
            out.push({ tick: last, pitch: first.pitch, gate: TPS - 4, vel: vel(last) });
        }
    }
    const run = out.filter((n) => n.tick >= tail && n.tick < end).sort((a, b) => a.tick - b.tick);
    if (!run.length) return;
    const target = nearestPitch(first.pitch, [next.root], first.pitch - 7, first.pitch + 7);
    const dir = target > first.pitch ? -1 : 1;
    const scale = scaleOf(ctx.key);
    run.forEach((n, j) => { n.pitch = scaleStep(scale, target, dir * (run.length - j)); });
}
