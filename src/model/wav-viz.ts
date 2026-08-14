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

export function detectWavViz(params: (KnobParam | null)[]): WavGroup[] {
    let position = -1;
    params.forEach((p, i) => {
        if (p && position < 0 && p.type === 'wav_position') position = i;
    });
    if (position < 0) return [];

    /* Prefer the module's OWN declaration of which file this marker indexes
     * (schwung's `filepath_param`) over "the first file param on the page" —
     * a page holding both a preset path and a sample path would otherwise be a
     * coin toss. Fall back to the guess when the module says nothing. */
    const want = params[position]?.filepathParam;
    let file: number | null = null;
    if (want) {
        const i = params.findIndex((p) => p?.key === want);
        if (i >= 0) file = i;
    }
    if (file === null) {
        params.forEach((p, i) => { if (file === null && p?.type === 'file') file = i; });
    }
    return [{ position, file }];
}
