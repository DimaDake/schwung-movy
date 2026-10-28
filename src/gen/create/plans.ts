/* New Clip's harmony (plans/2026-10-28-new-clip-design.md): a locked scene's
 * chords as the others play them; otherwise progressions in the key — the
 * loops groovebox tracks are built on — fitted, in a partial scene, around
 * what the others pin. One chord per bar on four bars or more, per half-bar
 * below, so even a one-bar clip moves. */

import type { GenCtx } from '../analysis/context.js';
import { fits, sample } from '../plan.js';
import { diatonic } from '../theory/roman.js';
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

const id = (cs: (Chord | null)[]) => cs.map((c) => (c ? c.root + c.quality : '-')).join();

function laid(ctx: GenCtx, p: Prog, n: number): Chord[] {
    const per = n >= 8 ? 2 : 1;
    return Array.from({ length: n }, (_, h) => diatonic(ctx.key, p[1][Math.floor(h / per) % p[1].length], !!p[2]));
}

export function createPlans(ctx: GenCtx, n: number): HarmonyPlan[] {
    if (ctx.freedom === 'locked') return [{ chords: sample(ctx.fixedChords, n), sit: 'asis', pedal: null, label: 'SCENE' }];
    const seen = new Set<string>();
    const out: HarmonyPlan[] = [];
    for (const p of ctx.key.minor ? MINOR : MAJOR) {
        const base = laid(ctx, p, n);
        const chords = ctx.freedom === 'partial' ? fits(ctx, base, 0) : base;
        const k = id(chords);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ chords, sit: 'asis', pedal: null, label: ctx.freedom === 'partial' ? p[0] + ' FIT' : p[0] });
    }
    return out;
}
