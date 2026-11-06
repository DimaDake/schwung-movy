/* BASSLINE: a new bass rhythm over the planned roots (user, 2026-10-27: "bass
 * may require more different"). A library of the bass figures electronic
 * music leans on, each note a role in the chord (root, octave, fifth, a
 * chord tone, an approach into the next chord), in the source's register,
 * velocity and feel. */

import { chordAt, type GenCtx } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import { custom, K } from '../knobs.js';
import { planAt } from '../plan.js';
import type { Preset } from '../preset.js';
import { mix, type Rng, rng } from '../rng.js';
import { kickSteps, lockFigure } from '../create/kick.js';
import { answerBar, answerCell, type Hit, riffCell, riffPitch } from '../create/riff.js';
import { dynamics } from '../shape/dynamics.js';
import { nearestPitch, pc } from '../theory/pc.js';
import { BAR, type Ev, TPS } from '../types.js';
import { finish, over, partEvs, someOf } from './helpers.js';

export type Part = 'r' | 'o' | 'f' | 't' | 'a';
/* [step, length in steps, part] per bar of 16ths. */
export const LIB: [string, [number, number, Part][]][] = [
    ['OFFBEAT', [[2, 2, 'r'], [6, 2, 'r'], [10, 2, 'r'], [14, 2, 'r']]],
    ['ROLLING', [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15].map((s) => [s, 1, 'r'] as [number, number, Part])],
    ['OCTAVES', [0, 2, 4, 6, 8, 10, 12, 14].map((s, i) => [s, 2, i % 2 ? 'o' : 'r'] as [number, number, Part])],
    ['ROOT-FIFTH', [[0, 4, 'r'], [4, 2, 'f'], [8, 4, 'r'], [12, 2, 'f'], [14, 2, 'a']]],
    ['3-3-2', [[0, 3, 'r'], [3, 3, 'r'], [6, 2, 'f'], [8, 3, 'r'], [11, 3, 'r'], [14, 2, 'a']]],
    ['GALLOP', [0, 3, 4, 7, 8, 11, 12, 15].map((s) => [s, 1, 'r'] as [number, number, Part])],
    ['HALF NOTES', [[0, 8, 'r'], [8, 8, 't']]],
    ['WALK', [[0, 4, 'r'], [4, 4, 't'], [8, 4, 'f'], [12, 4, 'a']]],
    ['PUMP 8THS', [0, 2, 4, 6, 8, 10, 12, 14].map((s) => [s, 1, 'r'] as [number, number, Part])],
];

const NOTES = ['AS WRITTEN', 'ROOTS ONLY', 'MORE FIFTHS', 'CHORD TONES', 'RIFF'] as const;
const RIFF = 4;

/* KICK, after OCTAVE BASS's (plans/2026-11-06-bass-over-chords-evaluation.md):
 * the scene's kick (create/kick.ts), each hit held to the next. */
const KICK = LIB.length + 4;

/** A bar's [step, length, part] hits: the library's, or the kick's (null
 *  when the scene has no kick). */
function figureOf(ctx: GenCtx, at: number): [number, number, Part][] | null {
    if (at !== KICK) return LIB[at][1];
    const k = lockFigure(ctx);
    return k.length ? k.map((s, i) => [s, Math.max(1, (k[i + 1] ?? 16 + k[0]) - s), 'r']) : null;
}

/** The figure nearest the source's density whose rhythm is not the source's. */
function defaultFigure(evs: Ev[], bars: number): number {
    const steps = new Set(evs.map((e) => Math.round(e.tick / TPS) % 16));
    const per = evs.length / Math.max(1, bars);
    let best = 0, bestS = 1e9;
    LIB.forEach(([, f], i) => {
        const both = f.filter(([s]) => steps.has(s)).length;
        if (both / (f.length + steps.size - both) >= 0.85) return;
        const sc = Math.abs(f.length - per);
        if (sc < bestS) { bestS = sc; best = i; }
    });
    return best;
}

/* OCTAVE BASS's figures (§2.7), after the library: the part's own notes,
 * half of the chosen ones jumping an octave. */
const OCTS = ['OFFBEATS', 'ALTERNATE', 'LAST', 'RANDOM'] as const;

function octaveBass(ctx: GenCtx, h: number, changes: number, fig: number, r: Rng): Ev[] {
    const out = over(ctx, partEvs(ctx), { h, changes });
    const pick = (e: Ev, i: number) => (fig === 0 ? strength(e.tick) < 0.7 : fig === 1 ? i % 2 === 1 : fig === 2 ? i % 4 === 3 : r() < 0.5);
    const cand = out.map((e, i) => i).filter((i) => pick(out[i], i));
    const sel = someOf(cand.length, 0.5, r);
    [...sel].forEach((j) => out[cand[j]].voices.forEach((x) => { x.pitch += x.pitch + 12 <= ctx.hi + 12 ? 12 : -12; }));
    return out;
}

export const BASSLINE: Preset = {
    id: 'v-bassline', name: 'BASSLINE', task: 'variation', drum: false, cls: 'rhythm', roles: ['bass'], fit: () => 0.65,
    seedAs: (v) => (v[0] >= LIB.length && v[0] < KICK ? 'v-octave' : undefined),
    knobs: [{ ...custom('PATTERN', [...LIB.map((x) => x[0]), ...OCTS.map((o) => 'OCT ' + o), 'KICK']), def: (c) => defaultFigure(partEvs(c), Math.max(1, c.end / BAR)),
        /* The first moved take locks to the kick, where the scene has one. */
        alt: (c) => (kickSteps(c).length ? KICK : undefined) },
        custom('NOTES', NOTES, RIFF), K.harmony(1), K.changes(0), K.length(5), custom('OCTAVE', ['-1 OCT', 'AS IS', '+1 OCT'], 1), K.dynamics(3), custom('SHIFT', ['0', '+1/16', '+2/16', '+3/16'], 0)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const src = partEvs(ctx);
        if (!src.length) return [];
        if (v[0] >= LIB.length && v[0] < KICK) return dynamics(finish(ctx, octaveBass(ctx, v[2], v[3], v[0] - LIB.length, r), { length: v[4] }, r), v[6]);
        const chords = planAt(ctx, v[2], v[3]).chords;
        const fig = figureOf(ctx, v[0]) ?? LIB[0][1];
        const shape = fig.map(([s, len]) => [s, len] as [number, number]);
        const cell = riffCell(shape, rng(mix(seed, 0x2177, v[0])));
        const cellB = answerCell(cell, shape, rng(mix(seed, 0x2178, v[0])));
        const vel = Math.round(src.reduce((s, e) => s + e.voices[0].vel, 0) / src.length);
        const base = ctx.lo + (v[5] - 1) * 12;
        let prev = base;
        const out: Hit[] = [];
        for (let bar = 0; bar * BAR < ctx.end; bar++) {
            for (const [i, [s, len, part0]] of fig.entries()) {
                const tick = bar * BAR + ((s + v[7]) % 16) * TPS;
                if (tick >= ctx.end) continue;
                const T = chordAt(chords, tick, ctx.k) ?? chordAt(ctx.srcChords, tick, ctx.k);
                if (!T) continue;
                let part = part0;
                if (v[1] === 1) part = part === 'o' ? 'o' : 'r';
                else if (v[1] === 2 && part === 'r' && strength(tick) < 0.7 && r() < 0.6) part = 'f';
                else if (v[1] === 3 && part === 'r' && strength(tick) < 0.7) part = 't';
                const root = nearestPitch(prev, [T.root], base - 5, base + 7);
                let p = root;
                if (v[1] === RIFF && part !== 'a') p = riffPitch(ctx, T, root, (bar % 2 ? cellB : cell)[i]);
                else if (part === 'o') p = root + 12;
                else if (part === 'f') p = nearestPitch(root + 7, [T.pcs[2] ?? pc(T.root + 7)], root, root + 12);
                else if (part === 't') p = nearestPitch(root + 4, [T.pcs[1] ?? T.root, T.pcs[2] ?? T.root], root, root + 12);
                else if (part === 'a') {
                    const N = chordAt(chords, tick + len * TPS, ctx.k) ?? T;
                    const nr = nearestPitch(root, [N.root], base - 5, base + 7);
                    p = nr === root ? root + 7 : nr + (nr > root ? -1 : 1);
                }
                prev = root;
                out.push({ tick, pitch: p, gate: Math.max(TPS / 2, len * TPS - 4), vel: Math.round(vel * (0.8 + 0.2 * strength(tick))) });
            }
        }
        /* RIFF phrases in twos, as New Clip's BASS does; AS WRITTEN stays the library's figure. */
        if (v[1] === RIFF) {
            const at = (t: number) => chordAt(chords, t % ctx.end, ctx.k) ?? chordAt(ctx.srcChords, t % ctx.end, ctx.k);
            for (let bar = 1; bar * BAR < ctx.end; bar += 2) {
                const next = at((bar + 1) * BAR);
                if (next) answerBar(ctx, out, bar, next, (t) => Math.round(vel * (0.8 + 0.2 * strength(t))));
            }
        }
        const evs: Ev[] = out.sort((a, b) => a.tick - b.tick).map((n) => ({ tick: n.tick, voices: [{ pitch: n.pitch, dt: 0, gate: n.gate, vel: n.vel }] }));
        return dynamics(finish(ctx, evs, { length: v[4] }, r), v[6]);
    },
};
