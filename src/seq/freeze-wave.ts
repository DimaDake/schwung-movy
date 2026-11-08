/* A frozen clip's waveform overview, as the engine serves it (lib.rs
 * `frzpk_<t>_<s>`: the window the loop was recorded over, in steps, and 256
 * peak columns across it). Fetched once per clip and kept until `frzp` says
 * a waveform changed — a get waits for a frame boundary, so never per tick. */

import { paramGet } from '../host/param.js';
import { freezePeaksSeq } from './freeze.js';

export type FrozenWave = { recStart: number; recLen: number; peaks: number[] };

const cache = new Map<string, FrozenWave | null>();
let seenSeq = '';

function parse(v: string | null): FrozenWave | null {
    const f = (v ?? '').split(' ');
    if (f.length !== 3) return null;
    const peaks: number[] = [];
    for (let i = 0; i + 1 < f[2].length; i += 2) peaks.push(parseInt(f[2].slice(i, i + 2), 16) || 0);
    const recStart = Number(f[0]), recLen = Number(f[1]);
    return peaks.length && recLen > 0 ? { recStart, recLen, peaks } : null;
}

export function frozenWave(track: number, slot: number): FrozenWave | null {
    if (freezePeaksSeq() !== seenSeq) {
        seenSeq = freezePeaksSeq();
        cache.clear();
    }
    const key = track + '_' + slot;
    if (!cache.has(key)) cache.set(key, parse(paramGet('frzpk_' + key)));
    return cache.get(key) ?? null;
}

export function resetFreezeWave(): void {
    cache.clear();
    seenSeq = '';
}
