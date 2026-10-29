/* New Clip's lines over the harmony (plans/2026-10-28-new-clip-design.md):
 * BASS plays the bass figures electronic music leans on (var-bass.ts's
 * library) or locks to the band's accents; ARP breaks each chord into a
 * pattern at a rate and span. */

import { strength } from '../analysis/events.js';
import { choice, chordUnder, HARMONY, place, velAt, withBand } from '../create/common.js';
import type { Preset } from '../preset.js';
import { withFeel } from '../create/feel.js';
import { rng } from '../rng.js';
import { nearestPitch, pc } from '../theory/pc.js';
import { type Note, TPS } from '../types.js';
import { LIB, type Part } from './var-bass.js';

const KICK = 'WITH KICK';
const BASS_NOTES = ['AS WRITTEN', 'ROOTS', 'CHORD TONES', 'OCTAVES'] as const;
/* The low end of the root's window. LOW and MID are the takes; DEEP folds
 * the roots under them, HIGH plays the line where a lead would sit. Lower
 * than DEEP the line's middle falls under E1, below what most speakers play. */
const BASE = [30, 36, 43, 48];

export const BASS: Preset = withFeel({
    id: 'n-bass', name: 'BASS', task: 'create', drum: false, cls: 'rhythm',
    knobs: [choice('PATTERN', [...LIB.map((x) => x[0]), KICK], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
        choice('NOTES', BASS_NOTES, [0, 0, 1, 2, 3]), choice('OCTAVE', ['DEEP', 'LOW', 'MID', 'HIGH'], [1, 2, 2]), HARMONY],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const fig: [number, number, Part][] = v[0] < LIB.length ? LIB[v[0]][1]
            : withBand(ctx, 6, [0, 4, 8, 12]).map((s, i, a) => [s, Math.max(1, (a[i + 1] ?? 16 + a[0]) - s - 1), 'r']);
        const base = BASE[v[2]];
        const out: Note[] = [];
        for (let bar = 0; bar * 16 < ctx.len; bar++) {
            fig.forEach(([s, len, part0], i) => {
                const step = bar * 16 + s;
                if (step >= ctx.len) return;
                const t = place(ctx, step);
                const c = chordUnder(ctx, v[3], t);
                const root = nearestPitch(base + 3, [c.bass ?? c.root], base - 2, base + 9);
                let part: Part = v[1] === 1 ? 'r' : part0;
                if (v[1] === 2 && strength(t) < 0.7) part = i % 2 ? 't' : 'f';
                if (v[1] === 3) part = i % 2 ? 'o' : 'r';
                const p = part === 'o' ? root + 12 : part === 'f' ? nearestPitch(root + 7, [c.pcs[2] ?? pc(c.root + 7)], root, root + 12)
                    : part === 't' ? nearestPitch(root + 4, c.pcs.slice(1), root + 1, root + 12)
                        : part === 'a' ? root + (r() < 0.5 ? -1 : 2) : root;
                out.push({ tick: t, pitch: p, gate: Math.max(TPS / 2, len * TPS - 4), vel: velAt(t, 100, r) });
            });
        }
        return out;
    },
}, [2, 8]);

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
}, [1, 6]);
