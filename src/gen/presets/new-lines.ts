/* New Clip's lines over the harmony (plans/2026-10-28-new-clip-design.md,
 * plans/2026-11-06-bass-over-chords-evaluation.md):
 * BASS plays the bass figures electronic music leans on (var-bass.ts's
 * library) or locks to the band's accents; ARP breaks each chord into a
 * pattern at a rate and span. */

import { strength } from '../analysis/events.js';
import { choice, chordUnder, HARMONY, place, velAt } from '../create/common.js';
import { patternKnob, patternMap, type PatternSpec } from '../create/pattern-knob.js';
import { heardUnder, struck } from '../create/push.js';
import { chordAt, type GenCtx } from '../analysis/context.js';
import { IND } from '../shape/rhythm-map.js';
import type { Preset } from '../preset.js';
import { withFeel } from '../create/feel.js';
import { rng } from '../rng.js';
import { nearestPitch, pc, sameChord, scaleOf } from '../theory/pc.js';
import { type Chord, type Note, TPS } from '../types.js';
import { LIB, type Part } from './var-bass.js';

/* PATTERN walks a map through the bass figures (create/pattern-knob.ts),
 * the band's accents (WITH KICK's successor) and Euclidean figures between. */
export const BASS_MAP: PatternSpec = { figs: LIB.map((x) => x[1].map((h) => h[0])), lo: 1, hi: 12, band: 6, own: true };

/** What a hit of a map position plays: the figure's own part where the hit
 *  is the figure's, else by where it falls: the bar's strong beats the root,
 *  the eighths between the fifth, the third or the octave in turn, sixteenths
 *  the root again (a rolling bass); a hit just before a chord change
 *  approaches it. */
function partOf(flavour: number, step: number, i: number, approach: boolean): Part {
    const own = LIB[flavour]?.[1].find((h) => h[0] === step);
    if (own) return own[2];
    if (approach) return 'a';
    if (IND[step] >= 12) return 'r';
    if (IND[step] >= 8) return (['f', 't', 'o'] as const)[i % 3];
    return 'r';
}
const BASS_NOTES = ['AS WRITTEN', 'ROOTS', 'CHORD TONES', 'OCTAVES'] as const;
/* The low end of the root's window. LOW is the take: the user's own lines
 * centre on Eb2-G2 and the public ones on Bb1-C2; MID is the brighter take,
 * DEEP folds the roots under them, HIGH plays the line where a lead would
 * sit. Lower than DEEP the line's middle falls under E1, below what most
 * speakers play. */
const BASE = [30, 36, 43, 48];
/* Takes favour the figures that leave room and the band's own accents (a
 * bass lands on the kick half the time in the public parts, 70% in pop):
 * the busy ones (ROLLING, OCTAVES, GALLOP, PUMP) are there to turn to. */
const TAKES = [9, 9, 9, 0, 3, 4, 6, 7, 1, 2, 5, 8];

/** The scale tone `n` steps from `p` (negative: down). */
function scaleStep(scale: number[], p: number, n: number): number {
    let q = p;
    for (let k = 0; k < Math.abs(n); k++) do q += Math.sign(n); while (!scale.includes(pc(q)));
    return q;
}

/** A step into the next chord's root: from the scale a step below or
 *  above it, else a semitone under it or a tone over. */
function approachTo(ctx: GenCtx, root: number, next: Chord, r: () => number): number {
    const t = nearestPitch(root, [next.root], root - 6, root + 6);
    const below = r() < 0.6;
    const step = scaleStep(scaleOf(ctx.key), t, below ? -1 : 1);
    if (Math.abs(step - t) <= 2 && r() < 0.6) return step;
    return t + (below ? -1 : 2);
}

/* A two-bar phrase: the answering bar's last beat walks up or down the
 * scale into the next bar's root (the user's lines end a phrase so; the
 * generator's copied one bar). A figure with nothing on the last eighth gets
 * a pickup there, unless it is the band's (it lands only on their hits). */
function answer(ctx: GenCtx, out: Note[], bar: number, next: Chord, band: boolean, r: () => number): void {
    const from = bar * 16 * TPS, tail = from + 12 * TPS, end = from + 16 * TPS, pick = from + 14 * TPS;
    const first = out.find((n) => n.tick >= from && n.tick < end);
    if (!first) return;
    if (!band && pick < ctx.len * TPS && !out.some((n) => n.tick >= pick && n.tick < end)) {
        const held = out.filter((n) => n.tick < pick && n.tick >= from).pop();
        if (held) held.gate = Math.min(held.gate, pick - held.tick - 4);
        out.push({ tick: pick, pitch: first.pitch, gate: 2 * TPS - 4, vel: velAt(pick, 96, r) });
    }
    const run = out.filter((n) => n.tick >= tail && n.tick < end).sort((a, b) => a.tick - b.tick);
    if (!run.length) return;
    const target = nearestPitch(first.pitch, [next.root], first.pitch - 7, first.pitch + 7);
    const dir = target > first.pitch || (target === first.pitch && r() < 0.5) ? -1 : 1;
    const scale = scaleOf(ctx.key);
    run.forEach((n, j) => { n.pitch = scaleStep(scale, target, dir * (run.length - j)); });
}

export const BASS: Preset = withFeel({
    id: 'n-bass', name: 'BASS', task: 'create', drum: false, cls: 'rhythm',
    knobs: [patternKnob(BASS_MAP, TAKES),
        choice('NOTES', BASS_NOTES, [0, 0, 1, 2, 3]), choice('OCTAVE', ['DEEP', 'LOW', 'MID', 'HIGH'], [1, 1, 2]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const m = patternMap(ctx, BASS_MAP);
        const at = Math.max(0, Math.min(m.steps.length - 1, v[0]));
        const steps = m.steps[at], f = m.flavour[at];
        const whole = LIB[f] && LIB[f][1].length === steps.length;
        /* A named figure keeps its own lengths; elsewhere a hit holds to the next. */
        const fig: [number, number][] = steps.map((s, i) => [s, whole ? LIB[f][1][i][1] : Math.max(1, (steps[i + 1] ?? 16 + steps[0]) - s)]);
        const base = BASE[v[2]];
        const heard = heardUnder(ctx, v[3]);
        const under = (t: number) => (heard ? chordAt(heard, t, ctx.k) : null) ?? chordUnder(ctx, v[3], t);
        const ticks: number[] = [];
        for (let bar = 0; bar * 16 < ctx.len; bar++) for (const [s] of fig) if (bar * 16 + s < ctx.len) ticks.push(place(ctx, bar * 16 + s));
        const chords = struck(ctx, v[3], ticks);
        const out: Note[] = [];
        let k = 0;
        for (let bar = 0; bar * 16 < ctx.len; bar++) {
            fig.forEach(([s, len], i) => {
                const step = bar * 16 + s;
                if (step >= ctx.len) return;
                const t = place(ctx, step);
                const c = chords[k++];
                const pushed = !sameChord(c, under(t));
                const approach = !pushed && k >= 2 && sameChord(chords[k - 2], c) && !sameChord(c, chords[k % chords.length]);
                const part0 = partOf(f, s, i, approach);
                /* Another track's chords give their root: its voicing's low
                 * note is the keyboard's inversion, not a bass note. */
                const root = nearestPitch(base + 3, [heard || ctx.freedom === 'locked' ? c.root : c.bass ?? c.root], base - 2, base + 9);
                let part: Part = v[1] === 1 ? 'r' : part0;
                if (v[1] === 2 && strength(t) < 0.7) part = i % 2 ? 't' : 'f';
                if (v[1] === 3) part = i % 2 ? 'o' : 'r';
                const p = part === 'o' ? root + 12 : part === 'f' ? nearestPitch(root + 7, [c.pcs[2] ?? pc(c.root + 7)], root, root + 12)
                    : part === 't' ? nearestPitch(root + 4, c.pcs.slice(1), root + 1, root + 12)
                        : part === 'a' ? approachTo(ctx, root, chords[k % chords.length], r) : root;
                out.push({ tick: t, pitch: p, gate: Math.max(TPS / 2, len * TPS - 4), vel: velAt(t, 100, r) });
            });
        }
        /* ROOTS and OCTAVES say what they play; the others phrase in twos. */
        if (v[1] === 0 || v[1] === 2) {
            const bars = Math.ceil(ctx.len / 16);
            for (let bar = 1; bar < bars; bar += 2) answer(ctx, out, bar, under(((bar + 1) * 16 * TPS) % ctx.end), f === LIB.length, r);
            out.sort((a, b) => a.tick - b.tick);
        }
        return out;
    },
}, [6, 10], false, 'bass');

const STYLES = ['UP', 'DOWN', 'UP-DOWN', 'ORDER', 'PINKY', 'BROKEN'] as const;
/* Slowest to fastest, so the knob turns one way. */
const RATES = [96, 48, 32, 24, 16];
/* Octaves the arp climbs: halves between, so a click adds a chord tone or two
 * rather than a whole octave. A tall arp starts lower, so its top stays in reach. */
const OCTS = [1, 1.5, 2, 2.5, 3, 4];

/** The chord's tones over `oct` octaves from `lo`, low to high. */
function ladder(pcs: number[], lo: number, oct: number): number[] {
    const out: number[] = [];
    for (let p = lo; p < lo + 12 * oct; p++) if (pcs.includes(pc(p))) out.push(p);
    return out;
}

function order(style: number, n: number, i: number, shuffle: number[]): number {
    if (style === 0) return i % n;
    if (style === 1) return n - 1 - (i % n);
    if (style === 2) { const m = Math.max(1, 2 * n - 2); const k = i % m; return k < n ? k : m - k; }
    if (style === 3) return shuffle[i % shuffle.length] % n;
    if (style === 4) return i % 2 ? n - 1 : (i >> 1) % Math.max(1, n - 1);
    return [0, 2, 1, 3][i % 4] % n;
}

export const ARP: Preset = withFeel({
    id: 'n-arp', name: 'ARP', task: 'create', drum: false, cls: 'rhythm',
    knobs: [choice('STYLE', STYLES, [0, 1, 2, 3, 4, 5]), choice('RATE', ['1/4', '1/8', '1/8T', '1/16', '1/16T'], [1, 3, 3, 3, 2]),
        choice('OCTAVES', OCTS.map(String), [0, 1, 2, 2]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const rate = RATES[v[1]];
        const shuffle = Array.from({ length: 8 }, () => Math.floor(r() * 16));
        const out: Note[] = [];
        for (let t = 0, i = 0; t < ctx.end; t += rate, i++) {
            const c = chordUnder(ctx, v[3], t);
            const oct = OCTS[v[2]];
            const tones = ladder(c.pcs, Math.max(48, Math.min(57, 93 - 12 * oct)), oct);
            const tick = rate === TPS ? place(ctx, t / TPS) : t;
            out.push({ tick, pitch: tones[order(v[0], tones.length, i, shuffle)], gate: Math.round(rate * 0.7), vel: velAt(t, 90, r) });
        }
        return out;
    },
}, [1, 6], false, 'line');
