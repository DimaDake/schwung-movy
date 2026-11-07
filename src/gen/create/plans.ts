/* New Clip's harmony (plans/2026-10-28-new-clip-design.md): progressions in
 * the key — the loops groovebox tracks are built on — fitted, in a partial
 * scene, around what the others pin. HARMONY is three sections by how many
 * chords a 4-bar phrase moves through (user, 2026-11-06): 2 (two bars a
 * chord), 4 (a bar a chord on four bars or more, a half-bar below, so even a
 * one-bar clip moves; a long clip may develop past four chords) and 8 (a
 * half-bar a chord). A locked scene's chords are the others'; HARMONY there
 * only adds approach chords between them (theory/changes.ts). */

import type { GenCtx } from '../analysis/context.js';
import { fits, pinOk, sample } from '../plan.js';
import { chordOf } from '../theory/pc.js';
import { diatonic } from '../theory/roman.js';
import { boldJourney, journey } from '../theory/develop.js';
import { CHANGES, withChanges } from '../theory/changes.js';
import { approached, lay, progId as id } from '../theory/sections.js';
import { walks } from '../theory/walk.js';
import { grow, type Loop, order } from './harmony-map.js';
import * as P from './progressions.js';
import { mix, rng } from '../rng.js';
import type { Chord, HarmonyPlan } from '../types.js';

/** Chord slots: one per bar on four bars or more, per half-bar below. */
const perOf = (n: number) => (n >= 8 ? 2 : 1);

const degrees = (ctx: GenCtx, p: P.Prog): Chord[] => p[1].map((d) => diatonic(ctx.key, d, !!p[2]));
const colour = (ctx: GenCtx, cs: P.Colour[1]): Chord[] => cs.map(([s, q]) => chordOf(ctx.key.tonic + s, q));

/* HARMONY's positions a section: up to this many loops on its map. */
const MAP = { 2: 40, 4: 128, 8: 56 } as const;

type Seed = (label: string, chords: (Chord | null)[], ext?: boolean) => void;
const seeder = (seeds: Loop[]): Seed => (label, chords, ext = false) => seeds.push({ label, chords, ext, seed: seeds.length });

/** One section's map: its seeds grown by the grammar, laid at `per`
 *  half-bars a chord, then on a line (create/harmony-map.ts). `seen` keeps a
 *  loop the 4 section already holds out of the others. */
function* section(ctx: GenCtx, n: number, count: 2 | 4 | 8, per: number, seeds: Loop[], extra: Loop[], seen: Set<string>):
    Generator<void, HarmonyPlan[], void> {
    /* Not `for (… of yield* …)`: QuickJS 2025-04-26 (the device's) throws
     * "stack underflow" on it (browser-test/source-rules.mjs bans it). */
    const grown = yield* grow(seeds, ctx.key, MAP[count]);
    const out: HarmonyPlan[] = [];
    const loops = [...grown, ...extra];
    for (let i = 0; i < loops.length; i++) {
        if (i && i % 32 === 0) yield;
        const l = loops[i];
        const base = lay(l.chords, n, per);
        const chords = ctx.freedom === 'partial' ? fits(ctx, base, 0) : base;
        const k = id(chords);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ chords, sit: 'asis', pedal: null, label: ctx.freedom === 'partial' ? l.label + ' FIT' : l.label, count,
            ...(l.ext ? { ext: true } : {}), ...(l.seed !== undefined ? { seed: l.seed } : {}) });
    }
    yield;
    return yield* order(out, ctx.key, per);
}

/** The 4 section: the named loops, walks and colour; on a clip with more
 *  slots than four, each also DEVELOPED (every repeat a different answer,
 *  theory/develop.ts) and the eight-chord ones. */
function fourSeeds(ctx: GenCtx, n: number): { seeds: Loop[]; bold: Loop[] } {
    const slots = Math.ceil(n / perOf(n));
    const long = slots > 4;
    const seeds: Loop[] = [];
    const seed = seeder(seeds);
    const short = ctx.key.minor ? P.MINOR : P.MAJOR;
    for (const p of short) seed(p[0], degrees(ctx, p));
    /* Each development's bold twin goes on after the grammar, so it neither
     * grows loops nor takes a place on the map from one: defaults and takes
     * are drawn as before it existed. */
    const bold: Loop[] = [];
    if (long) {
        for (const p of short.filter((x) => x[0] !== 'TONIC')) {
            seed(p[0] + '+DEV', journey(degrees(ctx, p), Math.ceil(slots / 4), ctx.key));
            const b = boldJourney(degrees(ctx, p), Math.ceil(slots / 4), ctx.key);
            if (b) bold.push({ label: p[0] + '+BOLD', chords: b, ext: true });
        }
        for (const p of ctx.key.minor ? P.LONG_MINOR : P.LONG_MAJOR) seed(p[0], degrees(ctx, p));
    }
    for (const p of ctx.key.minor ? P.MORE_MINOR : P.MORE_MAJOR) seed(p[0], degrees(ctx, p));
    /* Walks (theory/walk.ts): new loops every run, eight chords long where
     * the clip has room. */
    walks(ctx.key, long ? 8 : 4, 3, rng(mix(ctx.seed, 0x3A1C)), 1).forEach((w, i) => seed('WALK ' + (i + 1), w));
    for (const [name, cs] of ctx.key.minor ? P.COLOUR_MINOR : P.COLOUR_MAJOR) seed(name, colour(ctx, cs), true);
    return { seeds, bold };
}

function pairSeeds(ctx: GenCtx): Loop[] {
    const seeds: Loop[] = [];
    const seed = seeder(seeds);
    for (const p of ctx.key.minor ? P.PAIR_MINOR : P.PAIR_MAJOR) seed(p[0], degrees(ctx, p));
    for (const [name, cs] of ctx.key.minor ? P.PAIR_COLOUR_MINOR : P.PAIR_COLOUR_MAJOR) seed(name, colour(ctx, cs), true);
    return seeds;
}

/** The 8 section: the eight-chord progressions, eight-chord walks, and each
 *  four-chord loop with its approach chords. */
function eightSeeds(ctx: GenCtx): Loop[] {
    const seeds: Loop[] = [];
    const seed = seeder(seeds);
    for (const p of ctx.key.minor ? P.LONG_MINOR : P.LONG_MAJOR) seed(p[0], degrees(ctx, p));
    const four = [...(ctx.key.minor ? P.MINOR : P.MAJOR), ...(ctx.key.minor ? P.MORE_MINOR : P.MORE_MAJOR)].filter((p) => p[0] !== 'TONIC');
    for (const p of four) {
        const a = approached(degrees(ctx, p), ctx.key);
        if (a) seed(p[0] + ' 8', a);
    }
    walks(ctx.key, 8, 3, rng(mix(ctx.seed, 0x8C8)), 1).forEach((w, i) => seed('WALK 8-' + (i + 1), w));
    for (const [name, cs] of ctx.key.minor ? P.COLOUR_MINOR : P.COLOUR_MAJOR) {
        const a = approached(colour(ctx, cs), ctx.key);
        if (a) seed(name + ' 8', a, true);
    }
    return seeds;
}

/** One plan, then with approach chords added where they hold what the
 *  others play (theory/changes.ts): a locked scene's chords, or the one fit
 *  a partial scene's pins leave. */
function withRates(ctx: GenCtx, first: HarmonyPlan): HarmonyPlan[] {
    const base = first.chords;
    const out: HarmonyPlan[] = [first];
    if (!base.some((c) => c)) return out;
    const seen = new Set([id(base.flatMap((c) => [c, c]))]);
    const ok = pinOk(ctx);
    for (let level = 1; level < CHANGES.length; level++) {
        const chords = withChanges(base, level, ctx.key, ok);
        if (seen.has(id(chords))) continue;
        seen.add(id(chords));
        out.push({ chords, sit: 'asis', pedal: null, label: CHANGES[level] });
    }
    return out;
}

/** The plans for a New Clip: TONIC, then the 2, 4 and 8 sections, each one
 *  map where a turn changes a chord and its colour at its own end. A section
 *  shows where its chords fit the clip: 2 from two bars, 8 from four. */
export function* createPlans(ctx: GenCtx, n: number): Generator<void, HarmonyPlan[], void> {
    if (ctx.freedom === 'locked') return withRates(ctx, { chords: sample(ctx.fixedChords, n), sit: 'asis', pedal: null, label: 'SCENE' });
    const seen = new Set<string>();
    const { seeds, bold } = fourSeeds(ctx, n);
    /* The 4 section first, so its map is the one HARMONY always had. */
    const laid = yield* section(ctx, n, 4, perOf(n), seeds, bold, seen);
    const two = n >= 4 ? yield* section(ctx, n, 2, n >= 8 ? 4 : 2, pairSeeds(ctx), [], seen) : [];
    const eight = n >= 8 ? yield* section(ctx, n, 8, 1, eightSeeds(ctx), [], seen) : [];
    /* HARMONY's left end stays on the tonic (user, 2026-11-01: the left ends
     * mean "nothing moves"); a take never opens on it (runPlan). */
    const t = laid.findIndex((p) => p.label.startsWith('TONIC'));
    const four = t >= 0 ? [...laid.slice(0, t), ...laid.slice(t + 1)] : laid;
    const all = [...(t >= 0 ? [laid[t]] : []), ...two, ...four, ...eight];
    /* Pins that leave one fit would leave HARMONY dark: its rates instead. */
    return all.length === 1 ? withRates(ctx, all[0]) : all;
}

/** How many different chords a plan moves through. */
export const uniqueChords = (p: HarmonyPlan): number => new Set(p.chords.filter((c) => c).map((c) => c!.root + c!.quality)).size;
