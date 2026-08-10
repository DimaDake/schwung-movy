/* What kind of list an enum's options are — cached per param.
 *
 * Classifying an enum means reading every option, several times: `isShapeEnum`
 * filters the whole list, `isFilterModeEnum` normalises each entry, and
 * `isSlopeEnum` runs `isFilterModeEnum` again before its own regex pass. Three
 * full scans for an enum that turns out to be neither.
 *
 * That is fine once. It was not fine per frame, and per frame is where it ran:
 * buildViewModel calls planPageLayout on every rebuild, which runs the LFO and
 * filter detectors over the page's params. A preset list of a thousand entries
 * cost ~0.25 ms per frame on V8 and considerably more on the device's QuickJS,
 * so opening or scrolling a long enum overlay lagged behind the knob.
 *
 * The answer is not to detect less but to detect once: an option list belongs to
 * a loaded module and never changes under it. Caching on the KnobParam gets the
 * invalidation for free — loadHierarchy builds fresh param objects, so a module
 * swap or reload starts over with no explicit cache to clear. */

import type { KnobParam } from '../types/param.js';
import { isShapeEnum } from './lfo-shapes.js';
import { isFilterModeEnum, isSlopeEnum } from './filter-mode.js';

export interface EnumClass {
    shape: boolean;      // a waveform picker (LFO shape viz)
    division: boolean;   // a clock-division list (LFO rate viz)
    filterMode: boolean; // a filter-type picker (filter curve viz)
    slope: boolean;      // a dB-per-octave picker (filter curve viz)
}

const NONE: EnumClass = { shape: false, division: false, filterMode: false, slope: false };

/* Options that read as clock divisions (1/4, 1/8T, 3/16) → a rate enum. Moved
 * here verbatim from lfo-viz so every scan of an option list goes through the
 * same cache; the test for it lives in the LFO viz suite. */
function isDivisionEnum(opts: string[] | null): boolean {
    return !!opts && opts.filter((o) => /\d\/\d/.test(o)).length * 2 >= opts.length;
}

export function enumClassOf(p: KnobParam): EnumClass {
    if (!p.options || p.options.length === 0) return NONE;
    return (p.enumClass ??= {
        shape: isShapeEnum(p.options),
        division: isDivisionEnum(p.options),
        filterMode: isFilterModeEnum(p.options),
        slope: isSlopeEnum(p.options),
    });
}
