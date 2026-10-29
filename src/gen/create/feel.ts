/* New Clip's second row of knobs, shared by every generator (user,
 * 2026-10-28: "chords not necessarily should be full length. We need a knob
 * to control gate and in general have more variety in the rhythm and note
 * length"). GATE sets how much of the space to the next onset a note holds;
 * VARY moves the rhythm and lengths bar to bar (a dropped hit, a push, a
 * repeat, a long or a short one); SWING and DYNAMICS shape the feel; drums
 * have HUMAN instead of GATE. Each generator writes its idea plain, on the
 * grid; the feel is laid over it here, after. */

import type { GenCtx } from '../analysis/context.js';
import { spanTo, toEvents, fromEvents } from '../analysis/events.js';
import type { KnobDef } from '../knobs.js';
import type { Preset } from '../preset.js';
import { mix, type Rng, rng } from '../rng.js';
import { dynamics } from '../shape/dynamics.js';
import { type Ev, type Note, TPS } from '../types.js';
import { amount, runPlan } from './common.js';
import { layInto, type Laid } from './land.js';
import { planSpans, type Span } from './phrase.js';
import { ladder, maskBeats, sparseKnob, type SparseKind } from './sparse.js';
import { bandAccent } from '../shape/seams.js';
import { STRUMS, strumEvent } from '../shape/strum.js';

const pct = (v: number) => v * 10 + '%';

export const gate = (lo: number, hi: number): KnobDef => ({ ...amount('GATE', 10, lo, hi), label: (v) => (v === 10 ? 'HELD' : pct(v)) });
const VARY: KnobDef = { ...amount('VARY', 10, 1, 5), def: () => 0, label: pct };
const DYN: KnobDef = { ...amount('DYNAMICS', 10, 2, 6), def: () => 0, label: pct };
const HUMAN: KnobDef = { ...amount('HUMAN', 10, 1, 3), def: () => 0, label: pct };
/* The scene's swing when it has one; otherwise a take may swing a little. */
const SWING: KnobDef = { name: 'SWING', steps: () => 11, def: (c) => Math.min(10, Math.round(c.groove.swing / 0.05)),
    label: (v) => (50 + v * 2.5).toFixed(1).replace('.0', '') + '%',
    roll: (c, r) => (c.groove.swing > 0 ? Math.min(10, Math.round(c.groove.swing / 0.05)) : [0, 0, 0, 1, 2, 3][Math.floor(r() * 6)]) };

/** The note-length share of the space to the next onset at a GATE position. */
const share = (v: number) => 0.1 + 0.09 * v;

/* VARY: each event after the first may be dropped, pushed a 16th either way,
 * repeated half way to the next one, or held longer or shorter. Which events
 * vary, and how, is fixed per part, and each click varies one event more (or
 * v·5.5% of them on a long part): a turn walks, and no click is dead while
 * there is an event left to vary (bench 2026-10-29: 76% of clicks were). */
function vary(ctx: GenCtx, evs: Ev[], v: number, r: Rng, drum: boolean): { evs: Ev[]; len: Map<Ev, number> } {
    const len = new Map<Ev, number>();
    const taken = new Set(evs.map((e) => Math.round(e.tick / TPS)));
    const draws = evs.map(() => [r(), r(), r(), r()]);
    const open = evs.map((e, i) => i).filter((i) => evs[i].tick !== 0 && !bandAccent(ctx, evs[i].tick))
        .sort((a, b) => draws[a][0] - draws[b][0]);
    const picked = new Set(open.slice(0, v <= 0 ? 0 : Math.max(v, Math.round(v * 0.055 * evs.length))));
    const out: Ev[] = [];
    evs.forEach((e, i) => {
        /* What the part plays with the band stays: the variation is around it. */
        if (!picked.has(i)) { out.push(e); return; }
        const [, k, d, l] = draws[i];
        const step = Math.round(e.tick / TPS);
        /* Its kind first, then the next one that can apply here: a push onto
         * a taken step or a held drum hit would leave the click dead. */
        for (let j = 0; j < 4; j++) {
            const kind = (Math.floor(k * 4) + j) % 4;
            if (kind === 0 && !(drum && step % 16 === 0)) return;                    // dropped
            if (kind === 1) {                                                        // pushed
                const to = step + (d < 0.6 ? -1 : 1);
                if (to > 0 && to * TPS < ctx.end && !taken.has(to)) { taken.add(to); out.push({ ...e, tick: e.tick + (to - step) * TPS }); return; }
            }
            if (kind === 2) {                                                        // repeated
                const half = Math.round(spanTo(evs, i, ctx.end) / 2 / TPS) * TPS;
                if (half >= TPS && e.tick + half < ctx.end) {
                    out.push(e, { tick: e.tick + half, voices: e.voices.map((x) => ({ ...x, vel: x.vel * 0.85 })) });
                    return;
                }
            }
            if (kind === 3 && !drum) { len.set(e, l < 0.5 ? 0.45 : 1.8); break; }   // shorter or longer
        }
        out.push(e);
    });
    return { evs: out.sort((a, b) => a.tick - b.tick), len };
}

/* What DYNAMICS stays at where SPARSE took its knob: the middle of the
 * range its takes were drawn from. */
const SPARSE_DYN = 4;

interface Opts { strum: boolean; sparse?: SparseKind; h: number; spans: Span[] | null }

function feel(ctx: GenCtx, notes: Note[], f: number[], seed: number, drum: boolean, o: Opts): Note[] {
    if (!notes.length) return notes;
    const { strum } = o;
    const r = rng(mix(seed, 0xFEE1));
    const [g, v, sw, d] = drum ? [-1, f[0], f[1], f[2]] : f;
    const dyn = o.sparse ? SPARSE_DYN : d;
    const varied = vary(ctx, toEvents(notes), v, r, drum);
    const { len } = varied;
    const entry = o.sparse ? ladder(o.sparse, ctx.len)[d] : undefined;
    const laid: Laid | null = entry?.tpl && o.spans ? layInto(ctx, varied.evs, o.spans, o.sparse!, o.h, entry.tpl) : null;
    const evs = laid ? laid.evs : varied.evs;
    const at = new Map(evs.map((e) => [e, e.tick]));
    if (strum) {
        evs.forEach((e, i) => strumEvent(e, sw, spanTo(evs, i, ctx.end), r));
    } else {
        /* A part with no off-16ths swings its off-8ths, as 8th swing does;
         * unless the scene swings its own 16ths, which the part then follows. */
        const sixteenths = ctx.groove.swing > 0 || evs.some((e) => e.tick % (2 * TPS) === TPS);
        const [grid, by] = sixteenths ? [2 * TPS, 1] : [4 * TPS, 2];
        const swing = Math.round(sw * 0.05 * TPS * by);
        for (const e of evs) if (swing && e.tick % grid === grid / 2) e.tick += swing;
    }
    if (!drum) {
        evs.forEach((e, i) => {
            const room = spanTo(evs, i, ctx.end);
            const want = Math.round(room * share(g) * (len.get(e) ?? 1)) - (g >= 10 ? 2 : 0);
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
    let out = dynamics(fromEvents(evs, ctx.end), dyn);
    /* Masked after DYNAMICS, which reads the whole part, so what stays is
     * exactly what the full pattern plays there. */
    if (entry?.win) {
        const key = (n: Note) => n.tick * 128 + n.pitch;
        const kept = new Set(fromEvents(maskBeats(ctx, evs, at, entry.win), ctx.end).map(key));
        out = out.filter((n) => kept.has(key(n)));
    }
    if (drum && f[3] > 0) {
        out = out.map((n) => n.tick === 0 ? n : { ...n, tick: Math.max(0, n.tick + Math.round((r() - 0.5) * f[3])),
            vel: Math.max(1, Math.min(127, Math.round(n.vel + (r() - 0.5) * f[3] * 3))) });
    }
    return out;
}

const STRUM: KnobDef = { ...amount('STRUM', STRUMS.length - 1, 0, 4), def: () => 0, label: (v) => STRUMS[v] };

/** A generator with the feel row after its own four knobs; `g` is where its
 *  GATE takes are drawn (a pad holds, a stab does not). A held part, whose
 *  chords fall on the bar, strums instead of swinging. A generator with no
 *  density control of its own gets SPARSE of its kind for DYNAMICS. */
export function withFeel(p: Preset, g: [number, number] = [2, 8], strum = false, sp?: SparseKind, takes: string[] = []): Preset {
    const row = p.drum ? [VARY, SWING, DYN, HUMAN] : [gate(g[0], g[1]), VARY, strum ? STRUM : SWING, sp ? sparseKnob(sp, takes) : DYN];
    const hk = p.knobs.findIndex((k) => k.name === 'HARMONY');
    return { ...p, knobs: [...p.knobs, ...row],
        generate: (ctx, v, seed) => {
            const h = hk >= 0 ? v[hk] : runPlan(ctx);
            const tpl = sp ? ladder(sp, ctx.len)[v[7]]?.tpl : undefined;
            const spans = tpl ? planSpans(ctx, tpl, h, sp === 'counter') : null;
            /* A generator that phrases itself (MELODY) is handed the spans. */
            const notes = p.generate(ctx, v.slice(0, 4), seed, spans ?? undefined);
            return feel(ctx, notes, v.slice(4), seed, p.drum, { strum, sparse: sp, h, spans });
        } };
}
