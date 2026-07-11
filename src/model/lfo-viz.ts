/* Detects an LFO waveform-visualization group on a page: two adjacent knob
 * cells (Shape + Phase) that render as a single waveform graphic instead of two
 * knobs — the LFO analogue of the envelope group (see envelope.ts). Mode and
 * Retrigger are optional and read from anywhere on the page. Pure: indices only,
 * no rendering. */

import type { KnobParam } from '../types/param.js';

export interface LfoVizGroup {
    shape:  number;         // page-relative param indices
    phase:  number;
    mode:   number | null;
    retrig: number | null;
}

export function detectLfoViz(params: (KnobParam | null)[]): LfoVizGroup[] {
    let shape = -1, phase = -1, mode = -1, retrig = -1;
    params.forEach((p, i) => {
        if (!p || !p.lfo) return;
        if (p.lfo === 'shape'  && shape  < 0) shape  = i;
        else if (p.lfo === 'phase'  && phase  < 0) phase  = i;
        else if (p.lfo === 'mode'   && mode   < 0) mode   = i;
        else if (p.lfo === 'retrig' && retrig < 0) retrig = i;
    });
    if (shape < 0 || phase < 0) return [];
    return [{ shape, phase, mode: mode < 0 ? null : mode, retrig: retrig < 0 ? null : retrig }];
}
