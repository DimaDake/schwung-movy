/* New Clip's chord parts (plans/2026-10-28-new-clip-design.md): CHORDS
 * comps the progression, PAD holds it, STABS hits short chords off the beat.
 * Each voice-leads from chord to chord in its REGISTER, on the scene's swing,
 * and a figure may be the band's own accents. */

import type { GenCtx } from '../analysis/context.js';
import { choice, chordUnder, everyBar, HARMONY, place, register, velAt, withBand } from '../create/common.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { COMPS } from '../shape/rhythm.js';
import { sameChord } from '../theory/pc.js';
import { closeVoicing, spreadVoicing, voiceLead } from '../theory/voicing.js';
import { BAR, type Chord, type Note, TPS } from '../types.js';

const CENTRE = [55, 62, 69];

/** Voicings that move as little as they can, `n` voices around `centre`. */
function voicer(n: number, centre: number) {
    let prev: number[] = [];
    return (c: Chord): number[] => {
        const pcs = c.pcs;
        const req = [pcs[1], pcs[0], pcs[3], pcs[2]].filter((x) => x !== undefined);
        const v = prev.length === n ? voiceLead(prev, pcs, req, centre - 9, centre + 9) : closeVoicing(pcs, n, centre);
        prev = v.length ? v : closeVoicing(pcs, n, centre);
        return prev;
    };
}

function strike(out: Note[], tick: number, pitches: number[], gate: number, vel: number): void {
    for (const p of pitches) out.push({ tick, pitch: p, gate, vel });
}

const BAND = 'WITH BAND';
const comp = (ctx: GenCtx, v: number, figs: [string, number[]][]) =>
    (v >= figs.length ? withBand(ctx, 5, figs[0][1]) : figs[v][1]);

export const CHORDS: Preset = {
    id: 'n-chords', name: 'CHORDS', task: 'create', drum: false, cls: 'close',
    knobs: [choice('PATTERN', [...COMPS.map((x) => x[0]), BAND], [0, 1, 3, 4, 5, 7, 8]), choice('VOICES', ['3', '4', '5'], [0, 1, 1]),
        register([0, 1, 1, 2]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const steps = comp(ctx, v[0], COMPS);
        const voice = voicer(3 + v[1], CENTRE[v[2]]);
        const out: Note[] = [];
        everyBar(ctx, steps, (s, bar) => {
            const t = place(ctx, s);
            const i = steps.indexOf(s - bar * 16);
            const next = i + 1 < steps.length ? steps[i + 1] : 16 + steps[0];
            strike(out, t, voice(chordUnder(ctx, v[3], t)), Math.min(2 * BAR / 4, (next - steps[i]) * TPS - 4), velAt(t, 92, r));
        });
        return out;
    },
};

export const PAD: Preset = {
    id: 'n-pad', name: 'PAD', task: 'create', drum: false, cls: 'close',
    knobs: [choice('VOICES', ['3', '4', '5'], [1, 1, 2]), choice('SPREAD', ['CLOSE', 'OPEN', 'WIDE'], [0, 1, 1, 2]),
        register([0, 1, 1]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const voice = voicer(3 + v[0], CENTRE[v[2]]);
        const out: Note[] = [];
        /* A new chord where the harmony changes, and once a bar at least, so a
         * one-chord loop still breathes with the bar. */
        let at = 0;
        while (at < ctx.end) {
            const c = chordUnder(ctx, v[3], at);
            let to = at + TPS * 8;
            while (to < ctx.end && to % BAR !== 0 && sameChord(chordUnder(ctx, v[3], to), c)) to += TPS * 8;
            const pitches = spreadVoicing(voice(c), v[1], CENTRE[v[2]] - 14);
            strike(out, at, pitches, Math.max(TPS, to - at - 6), velAt(at, 78, r));
            at = to;
        }
        return out;
    },
};

const STAB_FIGS: [string, number[]][] = [['OFFBEAT', [2, 6, 10, 14]], ['HOUSE', [3, 6, 11, 14]], ['DOTTED', [0, 3, 6, 9, 12]],
    ['3-3-2', [0, 3, 6]], ['PUSH', [0, 7, 10]], ['SYNC', [2, 5, 8, 11, 14]], ['SKANK', [4, 12]]];
const STAB_LEN = [TPS / 2, TPS, 2 * TPS];

export const STABS: Preset = {
    id: 'n-stabs', name: 'STABS', task: 'create', drum: false, cls: 'rhythm',
    knobs: [choice('PATTERN', [...STAB_FIGS.map((x) => x[0]), BAND], [0, 1, 2, 3, 4, 5, 7]), choice('LENGTH', ['STAB', 'SHORT', 'MED'], [0, 1, 1]),
        register([1, 1, 2]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const steps = comp(ctx, v[0], STAB_FIGS);
        const voice = voicer(3, CENTRE[v[2]]);
        const out: Note[] = [];
        everyBar(ctx, steps, (s) => {
            const t = place(ctx, s);
            strike(out, t, voice(chordUnder(ctx, v[3], t)), STAB_LEN[v[1]], velAt(t, 100, r));
        });
        return out;
    },
};
