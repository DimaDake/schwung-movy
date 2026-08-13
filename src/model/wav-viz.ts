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
    let file: number | null = null;
    params.forEach((p, i) => {
        if (!p) return;
        if (position < 0 && p.type === 'wav_position') position = i;
        if (file === null && p.type === 'file') file = i;
    });
    return position < 0 ? [] : [{ position, file }];
}
