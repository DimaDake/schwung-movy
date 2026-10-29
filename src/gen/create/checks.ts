/* What makes a New Clip default worth offering (user, 2026-10-28: "every
 * time we generate default presets are unique and meaningful"): a part as
 * busy as its kind is, on the harmony where it counts, with some shape; a
 * groove with a downbeat and a backbeat or pulse, never a wall of hits. A
 * take that fails is rolled again (takes.ts). Knob turns are not checked:
 * the user may take a part anywhere, DENSITY 0 included. */

import type { GenCtx } from '../analysis/context.js';
import { isStrong, toEvents } from '../analysis/events.js';
import type { Preset } from '../preset.js';
import { pc, scaleOf } from '../theory/pc.js';
import { type Note, TPS } from '../types.js';
import { chordUnder, runPlan } from './common.js';

/* Onsets per bar each part keeps to, and whether its line needs a range. */
const PER_BAR: Record<string, [number, number, number]> = {   // min, max, min range (semitones)
    'n-chords': [1, 8, 0], 'n-pad': [0.5, 4, 0], 'n-stabs': [2, 8, 0], 'n-bass': [2, 12, 0], 'n-arp': [4, 16, 3],
    'n-melody': [3, 12, 3], 'n-riff': [2, 12, 2], 'n-counter': [2, 12, 3],
};

function melodic(ctx: GenCtx, p: Preset, notes: Note[]): string | null {
    const evs = toEvents(notes);
    /* Per bar it sounds in: a phrased take (SPARSE) rests on purpose. */
    const bars = Math.max(1, new Set(evs.map((e) => Math.floor(e.tick / (16 * TPS)))).size);
    const [lo, hi, range] = PER_BAR[p.id] ?? [1, 16, 0];
    if (evs.length / bars < lo || evs.length / bars > hi) return 'density';
    const ps = notes.map((n) => n.pitch);
    if (Math.max(...ps) - Math.min(...ps) < range) return 'flat';
    if (p.id === 'n-bass' && ps.sort((a, b) => a - b)[ps.length >> 1] >= 55) return 'register';
    const sc = scaleOf(ctx.key);
    const strong = notes.filter((n) => isStrong(n.tick));
    const fit = strong.filter((n) => sc.includes(pc(n.pitch)) || chordUnder(ctx, runPlan(ctx), n.tick).pcs.includes(pc(n.pitch)));
    if (strong.length && fit.length < strong.length * 0.9) return 'harmony';
    const iois = new Set(evs.map((e, i) => (evs[i + 1]?.tick ?? e.tick + ctx.end) - e.tick));
    if (range > 0 && evs.length > 3 && iois.size < 2 && p.id !== 'n-arp') return 'rhythm';
    return null;
}

function drums(ctx: GenCtx, p: Preset, notes: Note[]): string | null {
    const bars = Math.max(1, ctx.len / 16);
    const steps = (pitch?: number) => new Set(notes.filter((n) => pitch === undefined || n.pitch === pitch).map((n) => Math.round(n.tick / TPS) % 16));
    if (p.perPad) return steps().size < 2 ? 'sparse' : steps().size > 14 && ctx.kit?.role[notes[0].pitch] !== 'hat' ? 'wall' : null;
    if (notes.length / bars > 28) return 'wall';
    if (p.id === 'n-perc') return notes.length / bars < 3 ? 'sparse' : null;
    const kick = ctx.kit?.by.kick[0], snare = ctx.kit?.by.snare[0];
    if (kick !== undefined && !notes.some((n) => n.pitch === kick && n.tick < TPS / 2)) return 'no downbeat';
    const backbeat = snare !== undefined && [...steps(snare)].some((s) => s === 4 || s === 12 || s === 8);
    const pulse = kick !== undefined && steps(kick).size >= 3;
    return backbeat || pulse ? null : 'no backbeat';
}

/** Why this take is not a meaningful default, or null when it is. */
export function unmeaning(ctx: GenCtx, p: Preset, notes: Note[]): string | null {
    if (!notes.length) return 'empty';
    return ctx.drum ? drums(ctx, p, notes) : melodic(ctx, p, notes);
}
