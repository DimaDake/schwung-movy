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

/** The column scale's FLOOR, microseconds per block.
 *
 *  Free auto-ranging would make a column legible on any set and comparable on
 *  none — not between sessions, and not across the CPU Optimize flag, which is
 *  the one comparison the page exists to make. So the scale does not follow the
 *  set downward: it sits at 1 ms, which is round and fits almost every chain the
 *  fleet has measured, and only ever grows. */
export const FULL_SCALE_US = 1000;

/** Steps the scale may take, once 1 ms is not enough.
 *
 *  A ladder rather than "round up to the next 100 us" so the number under the
 *  plot stays a number you can hold in your head, and so the plot does not
 *  re-scale by a hair every time a peak creeps up. */
const SCALE_LADDER = [FULL_SCALE_US, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 9000];

/** The scale this set needs, driven by the BARS — the settled means.
 *
 *  Explicitly NOT the held peaks, which was the first thing tried and is wrong:
 *  a peak is a single worst block, and loading a chain costs several
 *  milliseconds in `dlopen` and first-block allocation. On device that one
 *  transient took the scale to 5 ms and squashed every real column to nothing
 *  for the rest of the viewing — the same failure a fixed scale had, in reverse.
 *  The bar is what you read continuously, so the bar is what the plot fits.
 *
 *  A peak past the top is not lost: it clamps and its column says so with the
 *  detached cap. That is the ordinary bargain of a level meter — the scale
 *  follows the sustained level and the peak indicator clips.
 *
 *  Rises only, so it needs no hysteresis and no state of its own: a settled
 *  mean does not oscillate across a ladder step the way a peak does, and the
 *  ladder's gaps absorb what drift there is. */
export function scaleFor(columns: CpuColumn[]): number {
    let worst = 0;
    for (const c of columns) {
        if (c.totalUs > worst) worst = c.totalUs;
    }
    for (const step of SCALE_LADDER) {
        if (worst <= step) return step;
    }
    return SCALE_LADDER[SCALE_LADDER.length - 1];
}

/** The scale as the label under the plot draws it: `1MS`, `1.5MS`, `2MS`. */
export function scaleLabel(scaleUs: number): string {
    const ms = scaleUs / 1000;
    return (Number.isInteger(ms) ? String(ms) : ms.toFixed(1)) + 'MS';
}

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
    /** Microseconds at the top of a column. At least `FULL_SCALE_US`. */
    scaleUs: number;
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
        scaleUs: scaleFor(columns),
        wallUs,
        wallPeakUs,
        blockUs,
        load: wallUs / blockUs,
        peakLoad: wallPeakUs / blockUs,
        optimized: flagValue('cpuopt') > 0,
    };
}
