/* New Clip's harmony (plans/2026-10-28-new-clip-design.md): a locked scene's
 * chords as the others play them; otherwise progressions in the key — the
 * loops groovebox tracks are built on — fitted, in a partial scene, around
 * what the others pin. One chord per bar on four bars or more, per half-bar
 * below, so even a one-bar clip moves; a long clip may develop its
 * progression past four chords. */

import type { GenCtx } from '../analysis/context.js';
import { fits, sample } from '../plan.js';
import { chordOf } from '../theory/pc.js';
import { diatonic } from '../theory/roman.js';
import { journey } from '../theory/develop.js';
import { walks } from '../theory/walk.js';
import { grow, type Loop, order } from './harmony-map.js';
import { mix, rng } from '../rng.js';
import type { Chord, HarmonyPlan, Quality } from '../types.js';

type Prog = [string, number[], boolean?];   // name, degrees (0 = tonic), sevenths

const MAJOR: Prog[] = [
    ['POP', [0, 4, 5, 3]], ['DOO-WOP', [0, 5, 3, 4]], ['CADENCE', [0, 3, 4, 0]], ['II-V-I', [1, 4, 0, 0], true],
    ['VAMP', [0, 3, 0, 3]], ['LIFT', [3, 4, 5, 5]], ['SOUL', [0, 2, 3, 4], true], ['TONIC', [0, 0, 0, 0]],
];
const MINOR: Prog[] = [
    ['MINOR LOOP', [0, 5, 2, 6]], ['DESCENT', [0, 6, 5, 4]], ['CADENCE', [0, 3, 4, 0]], ['DRIFT', [0, 6, 5, 6]],
    ['VAMP', [0, 3, 0, 3]], ['EPIC', [0, 5, 6, 0]], ['DEEP', [0, 3, 6, 2], true], ['TONIC', [0, 0, 0, 0]],
];

/* More of the loops in the key (user, 2026-10-29: "more harmony options for
 * chord generators on new scenes"), after the first eight so those keep
 * their positions. Diatonic, so a take may open on them. */
const MORE_MAJOR: Prog[] = [
    ['SENSITIVE', [5, 3, 0, 4]], ['ROYAL ROAD', [3, 4, 2, 5]], ['TURNAROUND', [0, 5, 1, 4]], ['SWAY', [0, 1, 0, 1], true],
];
const MORE_MINOR: Prog[] = [
    ['HOOK', [0, 2, 6, 5]], ['RISE', [5, 6, 0, 0]], ['SHUTTLE', [0, 6, 0, 6]], ['FALL', [0, 4, 5, 2], true],
];

/* Borrowed and modal colour, chords from outside the key as semitones over
 * the tonic: the end of the knob, for a more experimental take (user: "extended
 * ranges add more experimental flavor"). Never drawn for a take. */
type Colour = [string, [number, Quality][]];
const COLOUR_MAJOR: Colour[] = [
    ['MIXOLYDIAN', [[0, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']]], ['MINOR IV', [[0, 'maj'], [5, 'maj'], [5, 'min'], [0, 'maj']]],
    ['BVI BVII', [[8, 'maj'], [10, 'maj'], [0, 'maj'], [0, 'maj']]], ['BACKDOOR', [[2, 'm7'], [10, '7'], [0, 'maj7'], [0, 'maj7']]],
    ['LYDIAN', [[0, 'maj'], [2, 'maj'], [0, 'maj'], [2, 'maj']]],
];
const COLOUR_MINOR: Colour[] = [
    ['DORIAN', [[0, 'min'], [5, 'maj'], [0, 'min'], [5, 'maj']]], ['PHRYGIAN', [[0, 'min'], [1, 'maj'], [0, 'min'], [1, 'maj']]],
    ['HARMONIC', [[0, 'min'], [5, 'min'], [7, 'maj'], [0, 'min']]], ['ANDALUSIAN', [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'maj']]],
    ['PICARDY', [[0, 'min'], [5, 'min'], [10, 'maj'], [0, 'maj']]],
];

/* Eight-chord progressions, for clips with eight chord slots or more. */
const LONG_MAJOR: Prog[] = [['CIRCLE', [0, 3, 6, 2, 5, 1, 4, 0]], ['CANON', [0, 4, 5, 2, 3, 0, 3, 4]], ['ROAD', [0, 5, 3, 4, 0, 2, 3, 4]]];
const LONG_MINOR: Prog[] = [['CIRCLE', [0, 3, 6, 2, 5, 1, 4, 0]], ['LAMENT', [0, 6, 5, 4, 3, 2, 4, 4]], ['SAGA', [0, 5, 2, 6, 0, 3, 5, 4]]];

const id = (cs: (Chord | null)[]) => cs.map((c) => (c ? c.root + c.quality : '-')).join();

/** Chord slots: one per bar on four bars or more, per half-bar below. */
const perOf = (n: number) => (n >= 8 ? 2 : 1);

const degrees = (ctx: GenCtx, p: Prog): Chord[] => p[1].map((d) => diatonic(ctx.key, d, !!p[2]));

/** A slot list laid over the clip's half-bars, going round when shorter. */
function lay(slots: (Chord | null)[], n: number): (Chord | null)[] {
    const per = perOf(n);
    return Array.from({ length: n }, (_, h) => slots[Math.floor(h / per) % slots.length]);
}

/* HARMONY's positions: up to this many loops on the map. */
const MAP = 128;

/** The plans for a New Clip: the named loops, walks and colour as seeds;
 *  on a clip with more slots than four, each also DEVELOPED (every repeat a
 *  different answer, theory/develop.ts) and the eight-chord ones. The grammar
 *  derives more from them, and the whole lot is laid on a line where each
 *  next loop is one chord from the last (create/harmony-map.ts). */
export function* createPlans(ctx: GenCtx, n: number): Generator<void, HarmonyPlan[], void> {
    if (ctx.freedom === 'locked') return [{ chords: sample(ctx.fixedChords, n), sit: 'asis', pedal: null, label: 'SCENE' }];
    const slots = Math.ceil(n / perOf(n));
    const long = slots > 4;
    const wild = ctx.input.level === 'WILD';
    const seeds: Loop[] = [];
    const seed = (label: string, chords: (Chord | null)[], ext = false) => seeds.push({ label, chords, ext, seed: seeds.length });
    const short = ctx.key.minor ? MINOR : MAJOR;
    for (const p of short) seed(p[0], degrees(ctx, p));
    if (long) {
        for (const p of short.filter((x) => x[0] !== 'TONIC')) seed(p[0] + '+DEV', journey(degrees(ctx, p), Math.ceil(slots / 4), ctx.key, wild));
        for (const p of ctx.key.minor ? LONG_MINOR : LONG_MAJOR) seed(p[0], degrees(ctx, p));
    }
    for (const p of ctx.key.minor ? MORE_MINOR : MORE_MAJOR) seed(p[0], degrees(ctx, p));
    /* Walks (theory/walk.ts): new loops every run, eight chords long where
     * the clip has room. */
    walks(ctx.key, long ? 8 : 4, 3, rng(mix(ctx.seed, 0x3A1C)), 1).forEach((w, i) => seed('WALK ' + (i + 1), w));
    for (const [name, cs] of ctx.key.minor ? COLOUR_MINOR : COLOUR_MAJOR) seed(name, cs.map(([s, q]) => chordOf(ctx.key.tonic + s, q)), true);
    const seen = new Set<string>();
    const out: HarmonyPlan[] = [];
    /* Not `for (… of yield* …)`: QuickJS 2025-04-26 (the device's) throws
     * "stack underflow" on it (browser-test/source-rules.mjs bans it). */
    const grown = yield* grow(seeds, ctx.key, MAP);
    for (const l of grown) {
        const base = lay(l.chords, n);
        const chords = ctx.freedom === 'partial' ? fits(ctx, base, 0) : base;
        const k = id(chords);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ chords, sit: 'asis', pedal: null, label: ctx.freedom === 'partial' ? l.label + ' FIT' : l.label,
            ...(l.ext ? { ext: true } : {}), ...(l.seed !== undefined ? { seed: l.seed } : {}) });
    }
    yield;
    return yield* order(out, ctx.key, perOf(n));
}

/** How many different chords a plan moves through. */
export const uniqueChords = (p: HarmonyPlan): number => new Set(p.chords.filter((c) => c).map((c) => c!.root + c!.quality)).size;
