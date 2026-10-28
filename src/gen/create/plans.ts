/* New Clip's harmony (plans/2026-10-28-new-clip-design.md): a locked scene's
 * chords as the others play them; otherwise progressions in the key — the
 * loops groovebox tracks are built on — fitted, in a partial scene, around
 * what the others pin. One chord per bar on four bars or more, per half-bar
 * below, so even a one-bar clip moves; a long clip may develop its
 * progression past four chords. */

import type { GenCtx } from '../analysis/context.js';
import { fits, sample } from '../plan.js';
import { diatonic } from '../theory/roman.js';
import { journey } from '../theory/develop.js';
import type { Chord, HarmonyPlan } from '../types.js';

type Prog = [string, number[], boolean?];   // name, degrees (0 = tonic), sevenths

const MAJOR: Prog[] = [
    ['POP', [0, 4, 5, 3]], ['DOO-WOP', [0, 5, 3, 4]], ['CADENCE', [0, 3, 4, 0]], ['II-V-I', [1, 4, 0, 0], true],
    ['VAMP', [0, 3, 0, 3]], ['LIFT', [3, 4, 5, 5]], ['SOUL', [0, 2, 3, 4], true], ['TONIC', [0, 0, 0, 0]],
];
const MINOR: Prog[] = [
    ['MINOR LOOP', [0, 5, 2, 6]], ['DESCENT', [0, 6, 5, 4]], ['CADENCE', [0, 3, 4, 0]], ['DRIFT', [0, 6, 5, 6]],
    ['VAMP', [0, 3, 0, 3]], ['EPIC', [0, 5, 6, 0]], ['DEEP', [0, 3, 6, 2], true], ['TONIC', [0, 0, 0, 0]],
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

/** The plans for a New Clip: each progression as a loop; on a clip with more
 *  slots than four, each also DEVELOPED (every repeat a different answer,
 *  theory/develop.ts) and the eight-chord ones, so a long clip may move
 *  through more than four chords. */
export function createPlans(ctx: GenCtx, n: number): HarmonyPlan[] {
    if (ctx.freedom === 'locked') return [{ chords: sample(ctx.fixedChords, n), sit: 'asis', pedal: null, label: 'SCENE' }];
    const slots = Math.ceil(n / perOf(n));
    const long = slots > 4;
    const wild = ctx.input.level === 'WILD';
    const cands: [string, (Chord | null)[]][] = [];
    const short = ctx.key.minor ? MINOR : MAJOR;
    for (const p of short) cands.push([p[0], degrees(ctx, p)]);
    if (long) {
        for (const p of short.filter((x) => x[0] !== 'TONIC')) cands.push([p[0] + '+DEV', journey(degrees(ctx, p), Math.ceil(slots / 4), ctx.key, wild)]);
        for (const p of ctx.key.minor ? LONG_MINOR : LONG_MAJOR) cands.push([p[0], degrees(ctx, p)]);
    }
    const seen = new Set<string>();
    const out: HarmonyPlan[] = [];
    for (const [name, prog] of cands) {
        const base = lay(prog, n);
        const chords = ctx.freedom === 'partial' ? fits(ctx, base, 0) : base;
        const k = id(chords);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ chords, sit: 'asis', pedal: null, label: ctx.freedom === 'partial' ? name + ' FIT' : name });
    }
    return out;
}

/** How many different chords a plan moves through. */
export const uniqueChords = (p: HarmonyPlan): number => new Set(p.chords.filter((c) => c).map((c) => c!.root + c!.quality)).size;
