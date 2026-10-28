/* RHYTHM: a part's rhythm changed while its notes, role and harmony stay
 * (user, 2026-10-27: "I don't like rhythmic limitations"). Applied to the
 * source's events before they are realised, so every new onset takes its
 * notes from the source moment it now sits in. */

import type { GenCtx } from '../analysis/context.js';
import { spanTo, strength } from '../analysis/events.js';
import { type Rng, shuffled } from '../rng.js';
import { euclid } from '../theory/pc.js';
import { BAR, type Ev, TPS } from '../types.js';

export const RHYTHMS = ['KEEP', 'PUSH', 'SYNCOPATE', 'DOUBLE', 'HALF', 'COMP', 'EUCLID', 'SHUFFLE'] as const;

/* Comping rhythms, per bar of 16ths, the styles a groovebox part uses. */
export const COMPS: [string, number[]][] = [
    ['QUARTERS', [0, 4, 8, 12]], ['OFFBEATS', [2, 6, 10, 14]], ['DUB', [4, 12]], ['HOUSE', [3, 6, 11, 14]],
    ['TRESILLO', [0, 3, 6, 8, 11, 14]], ['CHARLESTON', [0, 3, 8, 11]], ['PUSH', [0, 7, 10]], ['SYNC 16', [0, 3, 6, 10, 13]],
];

const stepsOf = (evs: Ev[]) => new Set(evs.map((e) => Math.round(e.tick / TPS) % 16));

/** The library pattern closest to a rhythm without being it. */
export function nearestComp(evs: Ev[]): number {
    const steps = stepsOf(evs);
    let best = 1;
    let bestS = -1;
    COMPS.forEach(([, s], i) => {
        const both = s.filter((x) => steps.has(x)).length;
        const sc = both / (s.length + steps.size - both);
        if (sc < 0.9 && sc > bestS) { bestS = sc; best = i; }
    });
    return best;
}

/** New onsets at `steps` of every bar, each sounding the source event that
 *  was playing there (or the first one). */
export function repattern(ctx: GenCtx, evs: Ev[], steps: number[], legato: boolean): Ev[] {
    if (!evs.length) return evs;
    const out: Ev[] = [];
    for (let bar = 0; bar * BAR < ctx.end; bar++) {
        steps.forEach((s, i) => {
            const tick = bar * BAR + s * TPS;
            if (tick >= ctx.end) return;
            const src = [...evs].reverse().find((e) => e.tick <= tick) ?? evs[0];
            const next = ((steps[i + 1] ?? 16 + steps[0]) - s) * TPS;
            out.push({ tick, voices: src.voices.map((x) => ({ ...x, dt: 0,
                gate: legato ? next - 4 : Math.min(x.gate, Math.max(TPS / 2, next - 4)),
                vel: Math.round(x.vel * (0.75 + 0.25 * strength(tick))) })) });
        });
    }
    return out;
}

const dedupe = (evs: Ev[]) => evs.sort((a, b) => a.tick - b.tick).filter((e, i, a) => i === 0 || e.tick !== a[i - 1].tick);

export function rhythmStage(ctx: GenCtx, evs: Ev[], v: number, r: Rng): Ev[] {
    if (v <= 0 || evs.length < 1) return evs;
    const held = ctx.role?.kind === 'pad' || ctx.role?.kind === 'drone';
    const name = RHYTHMS[v];
    if (name === 'PUSH') {
        const hit = evs.map((e) => e.tick > 0 && strength(e.tick) >= 0.7);
        if (!hit.some((x) => x)) hit[evs.length - 1] = true;
        return dedupe(evs.map((e, i) => (hit[i] ? { tick: Math.max(0, e.tick - 2 * TPS),
            voices: e.voices.map((x) => ({ ...x, gate: x.gate + 2 * TPS })) } : e)));
    }
    if (name === 'SYNCOPATE') {
        return dedupe(evs.map((e) => (e.tick % (4 * TPS) === 0 && e.tick % BAR !== 0 && r() < 0.6
            ? { tick: Math.min(ctx.end - TPS, e.tick + (r() < 0.5 ? 2 : -1) * TPS), voices: e.voices } : e)));
    }
    if (name === 'DOUBLE') {
        const extra = evs.flatMap((e, i) => {
            const span = spanTo(evs, i, ctx.end);
            if (span < 2 * TPS) return [];
            const t = e.tick + Math.round(span / 2 / TPS) * TPS;
            return t < ctx.end ? [{ tick: t, voices: e.voices.map((x) => ({ ...x, dt: 0, gate: Math.max(TPS / 2, Math.round(x.gate / 2)),
                vel: Math.round(x.vel * 0.85) })) }] : [];
        });
        return dedupe([...evs.map((e, i) => ({ tick: e.tick, voices: e.voices.map((x) => ({ ...x,
            gate: Math.min(x.gate, Math.max(TPS / 2, Math.round(spanTo(evs, i, ctx.end) / 2) - 2)) })) })), ...extra]);
    }
    if (name === 'HALF') {
        if (evs.length < 2) return evs;
        const keep = evs.filter((e, i) => i % 2 === 0 || strength(e.tick) >= 0.85);
        return keep.map((e, i) => ({ tick: e.tick, voices: e.voices.map((x) => ({ ...x, gate: Math.max(x.gate, spanTo(keep, i, ctx.end) - 4) })) }));
    }
    if (name === 'COMP') return repattern(ctx, evs, COMPS[nearestComp(evs)][1], held);
    if (name === 'EUCLID') {
        const perBar = Math.max(2, Math.min(15, Math.round(evs.length / Math.max(1, ctx.end / BAR)) + 1));
        const rot = 1 + Math.floor(r() * 3);
        const steps = euclid(perBar, 16, rot).map((on, s) => (on ? s : -1)).filter((s) => s >= 0);
        return repattern(ctx, evs, steps, held);
    }
    /* SHUFFLE: the gaps between onsets dealt out again. */
    const gaps = evs.map((e, i) => (i + 1 < evs.length ? evs[i + 1].tick : ctx.end + evs[0].tick) - e.tick);
    const sh = shuffled(r, gaps);
    let t = evs[0].tick;
    return evs.map((e, i) => { const x = { tick: t, voices: e.voices.map((y) => ({ ...y, gate: Math.min(y.gate, Math.max(TPS / 2, sh[i] - 2)) })) }; t += sh[i]; return x; })
        .filter((e) => e.tick < ctx.end);
}
