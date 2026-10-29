/* SPARSE (user, 2026-10-29: "I like the rhythmic pattern but I want it to
 * play only periodically … musical not random"; then "sparsed results are a
 * bit weird (no phrases)"): the knob's ladder, fullest to emptiest. Most
 * positions are phrase templates (create/phrase.ts, laid by create/land.ts:
 * each phrase lands, held, before its rest). CHORDS and STABS also keep
 * beat windows, a chord on a weak beat still saying the harmony (user: "beat
 * 3 only makes sense for chords only"); those mask by the beat a hit falls
 * in, the 16th before a beat leading into it.
 *
 * Positions are never judged by create/checks.ts unless a take rolls them
 * (MELODY, COUNTER, RIFF roll a phrased default), and checks.ts counts a
 * phrased take's notes per bar it sounds in. A turn past a part's usual
 * busyness is the user's choice. */

import type { GenCtx } from '../analysis/context.js';
import type { KnobDef } from '../knobs.js';
import { pick } from '../rng.js';
import { type Ev, TPS } from '../types.js';
import type { PhraseKind } from './land.js';
import { fits, T, type Tpl } from './phrase.js';

export type SparseKind = PhraseKind;

/* `near`: the beats of the bar a chord window wants; a bar that has no hit
 * there plays its hit nearest that beat instead, within an 8th of it. */
interface Win { name: string; on: (beat: number) => boolean; near?: number[] }
export interface Entry { name: string; win?: Win; tpl?: Tpl }

const inBar = (name: string, ks: number[]): Win => ({ name, on: (b) => ks.includes(b % 4), near: ks });
/* k beats spread as evenly as n allow (3 in 8 is the tresillo). */
function spread(k: number, n: number): Win {
    const hit = new Set(Array.from({ length: k }, (_, i) => Math.ceil((i * n) / k)));
    return { name: `${k} IN ${n}`, on: (b) => hit.has(b % n) };
}

const as = (t: Tpl, name: string, extra: Partial<Tpl> = {}): Tpl => ({ ...t, ...extra, name });
const LINE = [T.BREATH, T.CALLANS, T.AA, T.CALL, T.ONOFF, T.ANSWER, T.HOOK, T.END, T.LEADIN];
const TPLS: Record<SparseKind, Tpl[]> = {
    line: [...LINE, T.ONE],
    counter: [...LINE, T.ONE],
    melody: [...LINE, as(T.ONE, 'LONG TONES')],
    bass: [...LINE, as(T.CHANGES, 'ROOTS'), T.DUB],
    chord: [T.BREATH, as(T.CALL, 'LAY OUT'), T.ONOFF, T.END, T.CHANGES],
    pad: [T.BREATH, as(T.CALL, 'LAY OUT'), T.ONOFF, T.END, as(T.CHANGES, 'CHANGES', { change: 0.6 })],
};

function build(kind: SparseKind, len: number): Entry[] {
    const beats = Math.ceil(len / 4), bars = Math.ceil(len / 16);
    const out: Entry[] = [{ name: 'ALL' }];
    if (kind === 'chord') {
        const wins = [inBar('1+3', [0, 2]), inBar('2+4', [1, 3]), ...[0, 1, 2, 3].map((k) => inBar(`BEAT ${k + 1}`, [k]))];
        if (beats >= 8) wins.push(spread(3, 8));
        if (beats >= 16) wins.push(spread(5, 16));
        out.push(...wins.map((w) => ({ name: w.name, win: w })));
    }
    for (const t of TPLS[kind]) if (fits(t, bars)) out.push({ name: t.name, tpl: t });
    return out;
}

/* The knob's label is read every tick while it is held: build each ladder once. */
const cache = new Map<string, Entry[]>();
export function ladder(kind: SparseKind, len: number): Entry[] {
    const key = kind + len;
    let w = cache.get(key);
    if (!w) { w = build(kind, len); cache.set(key, w); }
    return w;
}

/** SPARSE for a kind of part; `takes` names the positions a take may roll
 *  (a phrased melody is the norm; a bass or a comp starts full). */
export const sparseKnob = (kind: SparseKind, takes: string[] = []): KnobDef => ({
    name: 'SPARSE', steps: (c) => ladder(kind, c.len).length, def: () => 0,
    label: (v, c) => ladder(kind, c.len)[v]?.name ?? 'ALL',
    ...(takes.length ? { roll: (c: GenCtx, r: () => number) => {
        const l = ladder(kind, c.len);
        const ok = [0, ...takes.map((n) => l.findIndex((e) => e.name === n)).filter((i) => i > 0)];
        return pick(r, ok);
    } } : {}) });

/** The events a chord part's beat window keeps; `at` is each event's tick
 *  before swing. */
export function maskBeats(ctx: GenCtx, evs: Ev[], at: Map<Ev, number>, w: Win): Ev[] {
    if (!evs.length) return evs;
    const steps = evs.map((e) => Math.round((at.get(e) ?? e.tick) / TPS));
    const beats = steps.map((s) => Math.floor(((s + 1) % ctx.len) / 4));
    const keep = new Set(evs.map((_, i) => i).filter((i) => w.on(beats[i])));
    if (w.near) {
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
