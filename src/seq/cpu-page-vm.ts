/* What the CPU page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so every
 * rule below can be asserted without a framebuffer.
 *
 * The three inputs arrive as raw strings on the status poll and are parsed
 * HERE, once per repaint, rather than on every poll — see seq/state.ts. */

import { seqState } from './state.js';
import { flagValue } from './flags.js';
import { TRACK_COUNT, trackKind } from '../track/ref.js';

/** Column full scale, microseconds per block. FIXED.
 *
 *  Auto-ranging to the heaviest track would make a column legible on any set
 *  and comparable on none — not between sessions, and not across the CPU
 *  Optimize flag, which is the one comparison the page exists to make. 1000 us
 *  is round and puts every chain the fleet has measured on scale. */
export const FULL_SCALE_US = 1000;

/** Fallback block period, microseconds — 128 frames at 44.1 kHz. Only used
 *  before the first poll carrying `chwall`; the engine computes the real one
 *  from the host's sample rate. */
const DEFAULT_BLOCK_US = 2902;

export type CpuColumnKind =
    /** Rendering in movy's chain render, with a cost. */
    | 'live'
    /** Loaded, but making no sound, so `chidle` is skipping it. Distinct from
     *  `empty` because "costs nothing right now" and "there is nothing here"
     *  are the two different answers to a bar reading zero. */
    | 'asleep'
    /** No module. */
    | 'empty'
    /** On the Schwung host, which renders outside movy entirely. Blank would
     *  say the track is free; this says it is not ours to measure. */
    | 'na';

export type CpuColumn = {
    kind: CpuColumnKind;
    totalUs: number;
    synthUs: number;
    peakUs: number;
};

export type CpuPageVM = {
    columns: CpuColumn[];
    wallUs: number;
    wallPeakUs: number;
    blockUs: number;
    /** Wall over block. NOT clamped — an overrun is the reading that matters
     *  most, and the bar clamping is the renderer's business, not this. */
    load: number;
    peakLoad: number;
    /** CPU Optimize. Only the header uses it: with the flag off a chain renders
     *  in one call, so `synthUs === totalUs` already and no segment needs a
     *  branch. */
    optimized: boolean;
};

function num(s: string | undefined): number {
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function buildCpuPageVM(): CpuPageVM {
    const triples = seqState.cpuCost ? seqState.cpuCost.split(',') : [];
    const [loadedHex, asleepHex] = (seqState.cpuMask || '0/0').split('/');
    const loaded = parseInt(loadedHex, 16) || 0;
    const asleep = parseInt(asleepHex, 16) || 0;
    const [wallStr, peakStr, blockStr] = (seqState.cpuWall || '').split('/');
    const blockUs = num(blockStr) || DEFAULT_BLOCK_US;
    const wallUs = num(wallStr);
    const wallPeakUs = num(peakStr);

    const columns: CpuColumn[] = [];
    for (let t = 0; t < TRACK_COUNT; t++) {
        if (trackKind(t) === 'host') {
            columns.push({ kind: 'na', totalUs: 0, synthUs: 0, peakUs: 0 });
            continue;
        }
        const bit = 1 << t;
        if (!(loaded & bit)) {
            columns.push({ kind: 'empty', totalUs: 0, synthUs: 0, peakUs: 0 });
            continue;
        }
        const [total, synth, peak] = (triples[t] || '').split('/');
        columns.push({
            kind: asleep & bit ? 'asleep' : 'live',
            totalUs: num(total),
            // Clamped to the total: the FX segment is drawn as the difference,
            // and a synth reading larger than its own block would draw it
            // negative.
            synthUs: Math.min(num(synth), num(total)),
            peakUs: num(peak),
        });
    }

    return {
        columns,
        wallUs,
        wallPeakUs,
        blockUs,
        load: wallUs / blockUs,
        peakLoad: wallPeakUs / blockUs,
        optimized: flagValue('cpuopt') > 0,
    };
}
