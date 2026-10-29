/* The target harmony for each HARMONY position (design §2). Locked: the
 * other tracks' chords, and the knob says how the part sits on them. Free:
 * the moves from the source's progression. Partial: the moves that tolerate
 * what the others pin, plus the closest diatonic fits around it. */

import type { GenCtx } from './analysis/context.js';
import { targetHalves } from './analysis/context.js';
import type { Chord, HarmonyPlan, Sit } from './types.js';
import { colourPcs } from './theory/category.js';
import { harmonicMoves, tolerates } from './theory/moves.js';
import { degreeOf, diatonic } from './theory/roman.js';
import { holds, withChanges } from './theory/changes.js';
import { createPlans } from './create/plans.js';

const SITS: [Sit, string][] = [['asis', 'AS PLAYED'], ['roots', 'ROOTS'], ['inv', 'INVERSION'], ['7th', '7TH'], ['9th', '9TH']];

export const sample = (a: (Chord | null)[], n: number): (Chord | null)[] =>
    Array.from({ length: n }, (_, i) => (a.length ? a[i % a.length] : null));

export function fits(ctx: GenCtx, base: (Chord | null)[], rank: number): (Chord | null)[] {
    const col = (c: Chord) => colourPcs(c, ctx.key);
    return base.map((b, i) => {
        const pins = ctx.pinned.length ? ctx.pinned[i % ctx.pinned.length] : [];
        if (!pins.length) return b;
        const cands = Array.from({ length: 7 }, (_, d) => diatonic(ctx.key, d)).filter((c) => tolerates(c, pins, col));
        if (!cands.length) return b;
        /* A pinned bass note is most often the root: a bass alone in the
         * scene is what tells the chords where to go. */
        const bass = ctx.pinnedBass[i % Math.max(1, ctx.pinnedBass.length)];
        const score = (c: Chord) => (pins.every((p) => c.pcs.includes(p)) ? 0 : 2)
            + (bass !== undefined && bass >= 0 && c.root === bass ? -4 : 0)
            + (b && c.root === b.root ? 0 : b ? 3 - c.pcs.filter((x) => b.pcs.includes(x)).length * 0.5 : 1);
        const sorted = cands.sort((x, y) => score(x) - score(y) || x.root - y.root);
        return sorted[Math.min(rank, sorted.length - 1)];
    });
}

export function buildPlans(ctx: GenCtx): HarmonyPlan[] {
    const n = targetHalves(ctx);
    if (ctx.task === 'create') return createPlans(ctx, n);
    if (ctx.task !== 'variation') return [{ chords: sample(ctx.fixedChords, n), sit: 'asis', pedal: null, label: 'SCENE' }];
    if (ctx.freedom === 'locked') {
        const chords = sample(ctx.fixedChords, n);
        return SITS.map(([sit, label]) => ({ chords, sit, pedal: null, label }));
    }
    const base = sample(ctx.srcChords, n);
    if (!base.some((c) => c)) return [{ chords: base, sit: 'asis', pedal: null, label: 'SAME' }];
    const wild = ctx.input.level === 'WILD';
    let moves = harmonicMoves(base, ctx.key, wild);
    if (ctx.freedom === 'partial') {
        const col = (c: Chord) => colourPcs(c, ctx.key);
        const ok = (cs: (Chord | null)[]) => cs.every((c, i) => !c || tolerates(c, ctx.pinned[i % ctx.pinned.length] ?? [], col));
        moves = moves.filter((m) => ok(m.chords));
        const seen = new Set(moves.map((m) => m.chords.map((c) => c ? c.root + c.quality : '-').join()));
        ['FIT', 'FIT 2', 'FIT 3'].forEach((label, r) => {
            const chords = fits(ctx, base, r);
            const id = chords.map((c) => c ? c.root + c.quality : '-').join();
            if (!seen.has(id)) { seen.add(id); moves.push({ name: label, dist: 0.2 + r * 0.25, chords, pedal: null }); }
        });
        moves.sort((a, b) => Number(!!a.ext) - Number(!!b.ext) || a.dist - b.dist);
    }
    if (!moves.length) return [{ chords: base, sit: 'asis', pedal: null, label: 'SAME' }];
    const sev = sevenths(base);
    return moves.map((m) => ({ chords: sev ? m.chords.map((c) => withSeventh(c, ctx)) : m.chords, sit: 'asis', pedal: m.pedal, label: m.name,
        ...(m.ext ? { ext: true } : {}) }));
}

/* The source's style carries over: a part that plays seventh chords gets
 * seventh chords in the new harmony too. */
const sevenths = (a: (Chord | null)[]) => {
    const cs = a.filter((c): c is Chord => !!c);
    return cs.length > 0 && cs.filter((c) => c.pcs.length > 3).length * 2 >= cs.length;
};

function withSeventh(c: Chord | null, ctx: GenCtx): Chord | null {
    if (!c || c.pcs.length > 3 || !['maj', 'min', 'dim'].includes(c.quality)) return c;
    const d = degreeOf(c, ctx.key);
    if (d < 0) return c;
    const s = diatonic(ctx.key, d, true);
    return s.pcs.slice(0, 3).join() === c.pcs.join() ? s : c;
}

/** Where HARMONY opens: a free scene moves somewhere (a B section changes
 *  its harmony), a locked one sits on the chords as played. */
export function defaultHarmony(ctx: GenCtx, far = 1): number {
    /* Partial: the closest fit around what the others pin comes first. */
    const basic = ctx.plans.filter((p) => !p.ext).length;
    if (ctx.freedom !== 'free' || basic <= 1) return 0;
    return Math.min(far, basic - 1);
}

export function planAt(ctx: GenCtx, h: number, changes = 0): HarmonyPlan {
    const p = ctx.plans[Math.max(0, Math.min(ctx.plans.length - 1, h))];
    /* A locked scene's chords are the other tracks': CHANGES cannot add any. */
    if (changes <= 0 || ctx.freedom === 'locked' || !p) return p;
    const key = `${h}:${changes}`;
    const hit = changesCache.get(ctx)?.get(key);
    if (hit) return hit;
    const col = (c: Chord) => colourPcs(c, ctx.key);
    const ok = (c: Chord, beat: number) => {
        const pins = ctx.pinned.length ? ctx.pinned[Math.floor(beat / 2) % ctx.pinned.length] : [];
        return holds(c, pins, col);
    };
    const out = { ...p, chords: withChanges(p.chords, changes, ctx.key, ok), label: p.label };
    if (!changesCache.has(ctx)) changesCache.set(ctx, new Map());
    changesCache.get(ctx)!.set(key, out);
    return out;
}

/* A plan at a CHANGES level is asked for on every knob turn: built once. */
const changesCache = new WeakMap<GenCtx, Map<string, HarmonyPlan>>();
