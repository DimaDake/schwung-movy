/* New Clip's feel knobs, shared by every generator (user, 2026-10-28:
 * "chords not necessarily should be full length. We need a knob to control
 * gate"). GATE sets how much of the space to the next onset a note holds;
 * SPACE lays the part into phrases; STRUM spreads a held chord; DYNAMICS
 * accents the beat; drums have HUMAN instead of GATE; DRIFT walks the take
 * a small move a click (drift.ts). No SWING (user, 2026-11-02): the part is
 * written straight and the set's swing swings it at playback. Each generator
 * writes its idea plain, on the grid; the feel is laid over it here, after,
 * reading its knobs by name, so a generator with more knobs of its own keeps
 * fewer of these (plans/2026-11-01-generator-ux-design.md §4). */

import type { GenCtx } from '../analysis/context.js';
import { spanTo, toEvents, fromEvents } from '../analysis/events.js';
import type { KnobDef } from '../knobs.js';
import type { Preset } from '../preset.js';
import { hash, mix, rng } from '../rng.js';
import { DRIFT, driftNotes } from '../drift.js';
import { planAt } from '../plan.js';
import { dynamics } from '../shape/dynamics.js';
import { type Note, TPS } from '../types.js';
import { amount, runPlan } from './common.js';
import { layInto, type Laid } from './land.js';
import { planSpans, type Span } from './phrase.js';
import { ladder, maskBeats, sparseKnob, type SparseKind } from './sparse.js';
import { bandAccent } from '../shape/seams.js';
import { STRUMS, strumEvent } from '../shape/strum.js';

const pct = (v: number) => v * 10 + '%';

export const gate = (lo: number, hi: number): KnobDef => ({ ...amount('GATE', 10, lo, hi), label: (v) => (v === 10 ? 'HELD' : pct(v)) });
const DYN: KnobDef = { ...amount('DYNAMICS', 10, 2, 6), def: () => 0, label: pct };
const HUMAN: KnobDef = { ...amount('HUMAN', 10, 1, 3), def: () => 0, label: pct };
/** The note-length share of the space to the next onset at a GATE position. */
const share = (v: number) => 0.1 + 0.09 * v;

/* What DYNAMICS sits at on a phrased part (SPACE's): the middle of the range
 * its takes were drawn from, so a default is the take it always was. */
const SPARSE_DYN = 4;

/** The feel knobs' positions by name; a knob the generator gave up plays at this. */
interface Feel { gate: number; strum: number; dyn: number; space: number; human: number; drift: number }

interface Opts { strum: boolean; sparse?: SparseKind; h: number; spans: Span[] | null }

function feel(ctx: GenCtx, notes: Note[], f: Feel, seed: number, drum: boolean, o: Opts): Note[] {
    if (!notes.length) return notes;
    const { strum } = o;
    const r = rng(mix(seed, 0xFEE1));
    const g = f.gate;
    const entry = o.sparse ? ladder(o.sparse, ctx.len)[f.space] : undefined;
    const raw = toEvents(notes);
    const laid: Laid | null = entry?.tpl && o.spans ? layInto(ctx, raw, o.spans, o.sparse!, o.h, entry.tpl) : null;
    const evs = laid ? laid.evs : raw;
    const at = new Map(evs.map((e) => [e, e.tick]));
    if (strum) evs.forEach((e, i) => strumEvent(e, f.strum, spanTo(evs, i, ctx.end), r));
    if (!drum) {
        evs.forEach((e, i) => {
            const room = spanTo(evs, i, ctx.end);
            const want = Math.round(room * share(g)) - (g >= 10 ? 2 : 0);
            /* A strummed voice starts late and still ends with the chord. */
            for (const x of e.voices) x.gate = Math.max(TPS / 3, Math.min(want - (strum ? x.dt : 0), ctx.end - e.tick - x.dt));
        });
    }
    /* A phrase's notes end inside it; its landing is held to its end. */
    if (laid) {
        for (const e of evs) {
            const lim = laid.hold.get(e);
            if (lim === undefined) continue;
            for (const x of e.voices) {
                const g = laid.lands.has(e) ? lim - x.dt - 4 : Math.min(x.gate, lim - x.dt - 2);
                x.gate = Math.max(TPS / 3, Math.min(g, ctx.end - e.tick - x.dt));
            }
        }
    }
    let out = dynamics(fromEvents(evs, ctx.end), f.dyn);
    /* Masked after DYNAMICS, which reads the whole part, so what stays is
     * exactly what the full pattern plays there. */
    if (entry?.win) {
        const key = (n: Note) => n.tick * 128 + n.pitch;
        const kept = new Set(fromEvents(maskBeats(ctx, evs, at, entry.win), ctx.end).map(key));
        out = out.filter((n) => kept.has(key(n)));
    }
    if (drum && f.human > 0) {
        out = out.map((n) => n.tick === 0 ? n : { ...n, tick: Math.max(0, n.tick + Math.round((r() - 0.5) * f.human)),
            vel: Math.max(1, Math.min(127, Math.round(n.vel + (r() - 0.5) * f.human * 3))) });
    }
    return out;
}

const STRUM: KnobDef = { ...amount('STRUM', STRUMS.length - 1, 0, 4), def: () => 0, label: (v) => STRUMS[v] };

/* Which feel knobs give way when a generator's own knobs and the row pass
 * eight: a melodic part drops DYNAMICS first, a drum part DRIFT. */
const GIVE: Record<'melodic' | 'drum', string[]> = { melodic: ['DYNAMICS', 'DRIFT'], drum: ['DRIFT', 'DYNAMICS'] };

/** A generator with the feel knobs after its own; `g` is where its GATE
 *  takes are drawn (a pad holds, a stab does not). A held part, whose chords
 *  fall on the bar, strums. `sp` is SPACE's kind of part. */
export function withFeel(p: Preset, g: [number, number] = [2, 8], strum = false, sp?: SparseKind, takes: string[] = []): Preset {
    const dynDef = !p.drum && sp ? SPARSE_DYN : 0;
    const dyn: KnobDef = { ...DYN, def: () => dynDef, ...(p.drum ? {} : { roll: undefined }) };
    let row: KnobDef[] = p.drum ? [HUMAN, dyn, DRIFT]
        : [gate(g[0], g[1]), ...(sp ? [sparseKnob(sp, takes)] : []), strum ? STRUM : dyn, DRIFT];
    for (const name of GIVE[p.drum ? 'drum' : 'melodic']) if (p.knobs.length + row.length > 8) row = row.filter((k) => k.name !== name);
    const n = p.knobs.length;
    const knobs = [...p.knobs, ...row];
    const hk = p.knobs.findIndex((k) => k.name === 'HARMONY');
    const at = (name: string) => knobs.findIndex((k) => k.name === name);
    const of = (v: number[], name: string, d: number) => (at(name) >= 0 ? v[at(name)] : d);
    return { ...p, knobs,
        generate: (ctx, v, seed) => {
            const h = hk >= 0 ? v[hk] : runPlan(ctx);
            const space = of(v, 'SPACE', 0);
            const tpl = sp ? ladder(sp, ctx.len)[space]?.tpl : undefined;
            const spans = tpl ? planSpans(ctx, tpl, h, sp === 'counter') : null;
            /* A generator that phrases itself (MELODY) is handed the spans. */
            const notes = p.generate(ctx, v.slice(0, n), seed, spans ?? undefined);
            const f: Feel = { gate: of(v, 'GATE', 0), strum: of(v, 'STRUM', 0), dyn: of(v, 'DYNAMICS', dynDef), space,
                human: of(v, 'HUMAN', 0), drift: of(v, 'DRIFT', 0) };
            const out = feel(ctx, notes, f, seed, p.drum, { strum, sparse: sp, h, spans });
            return f.drift ? driftNotes(ctx, out, f.drift, mix(seed, hash(p.id)), planAt(ctx, h)?.chords ?? []) : out;
        } };
}
