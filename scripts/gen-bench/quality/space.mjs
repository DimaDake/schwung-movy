/* Method 2, the knob-space map (plans/2026-10-29-generator-quality-metrics.md):
 * knobs interact, so one-at-a-time sweeps miss the corners a user reaches by
 * turning three of them. Per generator and request: random knob states, and
 * every one-click neighbour of the default. Reported as shares of musical /
 * experimental / broken, and how the default's neighbourhood sounds — a
 * default on the edge of the musical region is the wrong default. */
import { features, planOf, verdict } from './musical.mjs';

export const SAMPLES = 12;

export function spacePreset(G, ctx, p, seed) {
    const r = G.rng(G.mix(seed, G.hash(p.id)));
    const base = G.defaults(p, ctx);
    const steps = p.knobs.map((k) => k.steps(ctx));
    const judge = (v) => {
        const notes = G.regenerate(ctx, p, v);
        return verdict(notes ? features(G, ctx, notes, planOf(G, ctx, p, v)) : null, ctx.drum);
    };
    const random = Array.from({ length: SAMPLES }, () => judge(steps.map((n) => Math.floor(r() * n))));
    const near = [];
    for (let i = 0; i < base.length; i++) {
        for (const d of [-1, 1]) {
            const x = base[i] + d;
            if (x < 0 || x >= steps[i]) continue;
            const v = [...base]; v[i] = x;
            near.push(judge(v));
        }
    }
    return { preset: p.id, task: ctx.task, def: judge(base), random, near };
}

const share = (list, c) => (list.length ? list.filter((x) => x[0] === c).length / list.length : 0);

export function spaceSummary(results) {
    const all = results.flatMap((r) => r.random), near = results.flatMap((r) => r.near);
    const by = new Map();
    for (const r of results) {
        const k = `${r.task}:${r.preset}`;
        const e = by.get(k) ?? { random: [], near: [], def: [] };
        e.random.push(...r.random); e.near.push(...r.near); e.def.push(r.def);
        by.set(k, e);
    }
    const reasons = new Map();
    for (const [c, why] of all) if (c === 'broken') reasons.set(why, (reasons.get(why) ?? 0) + 1);
    return {
        samples: all.length,
        musical: share(all, 'musical'), experimental: share(all, 'experimental'), broken: share(all, 'broken'), refused: share(all, 'refused'),
        defMusical: share(results.map((r) => r.def), 'musical'), defBroken: share(results.map((r) => r.def), 'broken'),
        nearMusical: share(near, 'musical'), nearBroken: share(near, 'broken'),
        reasons: [...reasons].sort((a, b) => b[1] - a[1]),
        per: [...by].map(([k, e]) => ({ k, broken: share(e.random, 'broken'), musical: share(e.random, 'musical'),
            defBroken: share(e.def, 'broken'), nearBroken: share(e.near, 'broken'), n: e.random.length })),
    };
}
