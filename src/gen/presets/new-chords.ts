/* New Clip's chord parts (plans/2026-10-28-new-clip-design.md): CHORDS
 * comps the progression, PAD holds it, STABS hits short chords off the beat.
 * Each voice-leads from chord to chord in its REGISTER, on the scene's swing,
 * and a figure may be the band's own accents. */

import type { GenCtx } from '../analysis/context.js';
import { chordFloor } from '../shape/band-pitch.js';
import { choice, CHORD_REGISTER as R, chordUnder, everyBar, HARMONY, place, register, velAt } from '../create/common.js';
import { DENSITY, patternAt, patternDense, patternKnob, type PatternSpec } from '../create/pattern-knob.js';
import { struck } from '../create/push.js';
import type { Preset } from '../preset.js';
import { withFeel } from '../create/feel.js';
import { rng } from '../rng.js';
import { COMPS } from '../shape/rhythm.js';
import { sameChord } from '../theory/pc.js';
import { STYLE_LABELS } from '../theory/voicing-styles.js';
import { MOTIONS, type Motion, voiceAll } from '../theory/voicings.js';
import { BAR, type Chord, type Note, TPS } from '../types.js';

const CENTRE = R.centres;

/** The notes of a part's strikes: each strike's chord (create/push.ts),
 *  voiced all together in a VOICING style (theory/voicings.ts) with the top
 *  note near REGISTER, never under the band's floor (band-pitch.ts: a fifth
 *  over its bass). A chord held over several strikes keeps its notes, and
 *  the clip loops, so a chord that ends it and opens it is one chord. */
function voicePart(ctx: GenCtx, chords: Chord[], style: number, reg: number, motion: Motion = 'SMOOTH'): number[][] {
    const floor = chordFloor(ctx);
    const centre = CENTRE[reg];
    const runs: Chord[] = [];
    const at = chords.map((c) => {
        if (!runs.length || !sameChord(c, runs[runs.length - 1])) runs.push(c);
        return runs.length - 1;
    });
    const wrap = runs.length > 1 && sameChord(runs[0], runs[runs.length - 1]);
    if (wrap) runs.pop();
    const lo = Math.max(centre - 12, floor), hi = Math.max(centre + 12, lo + 18);
    const v = voiceAll(runs, ctx.key, { style, anchor: centre + 5, lo, hi, motion, loop: true, rung: reg });
    return at.map((i) => v[i % runs.length] ?? []);
}

function strike(out: Note[], tick: number, pitches: number[], gate: number, vel: number): void {
    for (const p of pitches) out.push({ tick, pitch: p, gate, vel });
}

/* VOICING: how a chord is stacked, thin to rich (voicing-styles.ts); a
 * take is drawn from `pool`. */
const VOICING = (pool: number[]) => choice('VOICING', STYLE_LABELS, pool);

/* PATTERN walks a map through the part's figures (create/pattern-knob.ts);
 * a take lands on one of them whole, or on the band's accents (the last). */
export const COMP_MAP: PatternSpec = { figs: COMPS.map((x) => x[1]), lo: 1, hi: 10, band: 5 };

export const CHORDS: Preset = withFeel({
    id: 'n-chords', name: 'CHORDS', task: 'create', drum: false, cls: 'close',
    knobs: [patternKnob(COMP_MAP, [1, 0, 3, 4, 5, 7, 8]), VOICING([1, 1, 2, 4, 5, 6]),
        register([R.LOW, R.LOW + 1, R.MID, R.MID, R.MID + 1, R.HIGH]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const steps = patternDense(ctx, COMP_MAP, v[0], v[4]);
        const hits: [number, number][] = [];
        everyBar(ctx, steps, (s, bar) => {
            const i = steps.indexOf(s - bar * 16);
            const next = i + 1 < steps.length ? steps[i + 1] : 16 + steps[0];
            hits.push([place(ctx, s), Math.min(2 * BAR / 4, (next - steps[i]) * TPS - 4)]);
        });
        const vs = voicePart(ctx, struck(ctx, v[3], hits.map((x) => x[0])), v[1], v[2]);
        const out: Note[] = [];
        hits.forEach(([t, g], i) => strike(out, t, vs[i], g, velAt(t, 92, r)));
        return out;
    },
}, [3, 8], false, 'chord', [], { at: 2, knob: DENSITY });

/* PATTERN on a pad: HELD strikes where the harmony changes (and once a bar);
 * a figure re-strikes the held chord on its steps, and a chord no step falls
 * in is still struck where it starts, so every change is heard. */
const PAD_FIGS: [string, number[]][] = [['HELD', []], ['BAR', [0]], ['HALVES', [0, 8]], ['3-3-2', [0, 6, 12]],
    ['CHARLESTON', [0, 6]], ['PUSH', [0, 14]], ['2+4', [4, 12]]];

/** Each change of the harmony, as [start, end) spans; `bars` also splits them at the bar. */
function changes(ctx: GenCtx, h: number, bars: boolean): [number, number][] {
    const spans: [number, number][] = [];
    let at = 0;
    while (at < ctx.end) {
        const c = chordUnder(ctx, h, at);
        let to = at + TPS * 8;
        while (to < ctx.end && !(bars && to % BAR === 0) && sameChord(chordUnder(ctx, h, to), c)) to += TPS * 8;
        spans.push([at, to]);
        at = to;
    }
    return spans;
}

/** A pad's strikes at a figure: its steps every bar, plus the start of a change none fell in. */
function padTicks(ctx: GenCtx, h: number, fig: number[]): number[] {
    const ticks: number[] = [];
    everyBar(ctx, fig, (s) => { ticks.push(place(ctx, s)); });
    for (const [a, b] of changes(ctx, h, false)) if (!ticks.some((t) => t >= a && t < b)) ticks.push(a);
    return ticks.sort((x, y) => x - y);
}

export const PAD: Preset = withFeel({
    id: 'n-pad', name: 'PAD', task: 'create', drum: false, cls: 'close',
    knobs: [VOICING([4, 1, 2, 5, 6, 8]), choice('MOTION', MOTIONS, [0, 0, 1, 2, 3]),
        register([R.LOW, R.LOW + 1, R.MID, R.MID]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const fig = PAD_FIGS[v[4] ?? 0]?.[1] ?? [];
        /* HELD: a new chord where the harmony changes, and once a bar at
         * least, so a one-chord loop still breathes with the bar. */
        const ticks = fig.length ? padTicks(ctx, v[3], fig) : changes(ctx, v[3], true).map((x) => x[0]);
        const chords = fig.length ? struck(ctx, v[3], ticks) : ticks.map((t) => chordUnder(ctx, v[3], t));
        const vs = voicePart(ctx, chords, v[0], v[2], MOTIONS[v[1]]);
        const out: Note[] = [];
        ticks.forEach((a, i) => strike(out, a, vs[i], Math.max(TPS, (ticks[i + 1] ?? ctx.end) - a - 6), velAt(a, 78, r)));
        return out;
    },
}, [5, 10], true, 'pad', [], { at: 1, knob: choice('PATTERN', PAD_FIGS.map((x) => x[0]), [0, 0, 1, 2, 3, 4, 5, 6]) });

const STAB_FIGS: [string, number[]][] = [['OFFBEAT', [2, 6, 10, 14]], ['HOUSE', [3, 6, 11, 14]], ['DOTTED', [0, 3, 6, 9, 12]],
    ['3-3-2', [0, 3, 6]], ['PUSH', [0, 7, 10]], ['SYNC', [2, 5, 8, 11, 14]], ['SKANK', [4, 12]]];
export const STAB_MAP: PatternSpec = { figs: STAB_FIGS.map((x) => x[1]), lo: 1, hi: 8, band: 5 };

export const STABS: Preset = withFeel({
    id: 'n-stabs', name: 'STABS', task: 'create', drum: false, cls: 'rhythm',
    knobs: [patternKnob(STAB_MAP, [0, 1, 2, 3, 4, 5, 7]), VOICING([1, 0, 1, 2, 3, 4]),
        register([R.MID, R.MID, R.MID + 1, R.HIGH]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const steps = patternAt(ctx, STAB_MAP, v[0]);
        const ticks: number[] = [];
        everyBar(ctx, steps, (s) => { ticks.push(place(ctx, s)); });
        const vs = voicePart(ctx, struck(ctx, v[3], ticks), v[1], v[2]);
        const out: Note[] = [];
        ticks.forEach((t, i) => strike(out, t, vs[i], TPS, velAt(t, 100, r)));
        return out;
    },
}, [0, 3], false, 'chord');
