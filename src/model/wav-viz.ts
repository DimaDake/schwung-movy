/* Detects a sample waveform group: a `wav_position` marker param and, when the
 * module puts one on the same page, its `file` companion. The graphic replaces
 * both cells — the waveform IS the sample and the marker IS the position, so a
 * filename string and a percentage arc say strictly less than the picture.
 * Pure: indices only, no I/O and no rendering. */

import type { KnobParam } from '../types/param.js';

export interface WavGroup {
    position: number;        // page-relative index of the wav_position param
    file: number | null;     // its sample-file companion on this page, if any
}

/* Index of the file param a marker names, or -1. */
const declaredFile = (params: (KnobParam | null)[], p: KnobParam): number =>
    p.filepathParam ? params.findIndex((q) => q?.key === p.filepathParam) : -1;

/* A marker is either typed `wav_position`, or a plain number that NAMES the
 * file it indexes. mrsample types its Start and Loop Start as floats and says
 * `filepath_param: sample_path`; the declaration is the module telling us this
 * knob is a position into that sample, and it is a stronger signal than the
 * type string. */
function isMarker(params: (KnobParam | null)[], p: KnobParam): boolean {
    if (p.type === 'wav_position') return true;
    if (p.type !== 'float' && p.type !== 'int') return false;
    return declaredFile(params, p) >= 0;
}

export function detectWavViz(params: (KnobParam | null)[]): WavGroup[] {
    let position = -1;
    params.forEach((p, i) => {
        if (p && position < 0 && isMarker(params, p)) position = i;
    });
    if (position < 0) return [];

    /* Prefer the module's OWN declaration of which file this marker indexes
     * over "the first file param on the page" — a page holding both a preset
     * path and a sample path would otherwise be a coin toss. */
    const marker = params[position] as KnobParam;
    let file: number | null = null;
    const declared = declaredFile(params, marker);
    if (declared >= 0) file = declared;
    else params.forEach((p, i) => { if (file === null && p?.type === 'file') file = i; });
    return [{ position, file }];
}
