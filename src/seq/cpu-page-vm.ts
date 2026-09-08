/* What the CPU page draws, as data.
 *
 * Same split as the other pages: the renderer is pure and takes this, so every
 * rule below can be asserted without a framebuffer.
 *
 * The four inputs arrive as raw strings on the status poll and are parsed
 * HERE, once per repaint, rather than on every poll — see seq/state.ts. */

import { seqState } from './state.js';
import { scaleFor } from './cpu-scale.js';
import { flagValue } from './flags.js';
import { TRACK_COUNT, trackKind } from '../track/ref.js';
import { SEND_BUSES } from '../chain/config.js';

/** Fallback block period, microseconds — 128 frames at 44.1 kHz. Only used
 *  before the first poll carrying `chwall`; the engine computes the real one
 *  from the host's sample rate. */
const DEFAULT_BLOCK_US = 2902;

/** The share of an audio block movy can actually spend before the device starts
 *  dropping samples. MEASURED on hardware, not derived: glitching sets in at
 *  65-69% of the raw block, so the bar is calibrated to 70% of it and 100% on
 *  this page means "at the edge", not "the block is full".
 *
 *  Two things account for the missing 30%. Move's own engine takes ~240 µs of
 *  the same block (about 8%). The rest is the gap between what this bar shows
 *  and what actually causes a dropout: the bar is a MEAN over blocks, and a
 *  dropout is one block missing its deadline — so a mean sitting at 100% of the
 *  raw block would already have been dropping samples for a long time. The peak
 *  notch is the individual worst block, and it is the one that hits the wall
 *  first. */
export const USABLE_BLOCK = 0.70;

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
    /* One per send bus, or EMPTY when no bus holds a module — the page's two
     * layouts are exactly `sends.length === 0` and not, and a set that uses no
     * send draws the plot it always did.
     *
     * All three arrive together once any one of them is filled, so a bus keeps
     * its column position whatever its neighbours are doing. An unfilled one is
     * `empty`, the same as an unused track. */
    sends: CpuColumn[];
    /** Microseconds at the top of a column. At least `FULL_SCALE_US`. */
    scaleUs: number;
    wallUs: number;
    wallPeakUs: number;
    blockUs: number;
    /** What movy may actually spend of `blockUs` — see `USABLE_BLOCK`. This,
     *  not the raw block, is what the bar and the percentage are against. */
    budgetUs: number;
    /** Wall over BUDGET. NOT clamped — an overrun is the reading that matters
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

    const sends = buildSendColumns(seqState.cpuSend);
    const budgetUs = Math.max(1, Math.round(blockUs * USABLE_BLOCK));
    return {
        columns,
        sends,
        scaleUs: scaleFor(columns, sends),
        wallUs,
        wallPeakUs,
        blockUs,
        budgetUs,
        load: wallUs / budgetUs,
        peakLoad: wallPeakUs / budgetUs,
        optimized: flagValue('cpuopt') > 0,
    };
}

/** The ` sndcost=` field as columns: `-,312/980,-` → three columns, the middle
 *  one live.
 *
 *  Returns EMPTY when no bus holds a module, which is what hides the whole send
 *  region. A bus reading `-` inside a non-empty result is a real answer — "this
 *  bus is free" — and a bus at zero is a third: loaded, and skipped this block
 *  because nothing is feeding it and its tail has died away. The page draws
 *  those two differently, which is the entire reason the engine sends a dash
 *  rather than `0/0`.
 *
 *  A send has no synth stage — a bus IS an FX pass over a buffer the tracks
 *  filled — so `synthUs` is 0 and the whole column draws as the hatched FX
 *  segment. That is not a gap in the data; it is what a send is. */
export function buildSendColumns(raw: string): CpuColumn[] {
    if (!raw) return [];
    const fields = raw.split(',');
    const cols: CpuColumn[] = [];
    for (let n = 0; n < SEND_BUSES; n++) {
        const f = fields[n];
        if (f === undefined || f === '-') {
            cols.push({ kind: 'empty', totalUs: 0, synthUs: 0, peakUs: 0 });
            continue;
        }
        const [total, peak] = f.split('/');
        const totalUs = num(total);
        cols.push({
            kind: totalUs > 0 ? 'live' : 'asleep',
            totalUs,
            synthUs: 0,
            peakUs: num(peak),
        });
    }
    return cols.some((c) => c.kind !== 'empty') ? cols : [];
}
