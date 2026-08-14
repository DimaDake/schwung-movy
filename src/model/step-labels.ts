/* Which knobs are drawn as a framed number instead of an arc. An arc shows a
 * position within a range, which is the wrong reading for a value the user
 * thinks of by name: an octave offset or a voice count. The cell normally shows
 * the param's NAME (renderer/label.ts) and its value only while the knob is
 * touched, so these were numbers you could not read without touching them.
 *
 * The param stays an int. Nothing here changes what is written to the DSP —
 * synthesizing an enum with options like "+1" would send that string to a module
 * expecting 1, which it coerces to a default that the next read-back snaps the
 * knob to (the mrdrums "loop" failure). */
import type { KnobParam } from '../types/param.js';
import { NARROW_RANGE_MAX } from './knob-step.js';

/* `oct`, `octave`, `octaves` as a whole word: octave, octave_transpose,
 * sub_octave, lane1_octave, arp_octaves. */
const OCTAVE_LIKE = /(^|_)oct(ave|aves)?(_|$)/;
/* Moog's oscN_range is an octave selector by meaning (the Model D's 32'..2'
 * switch). Only when signed — hera's pitch_range 0..2 is a bend depth. */
const SIGNED_RANGE = /_range$/;
/* A count of voices, at any width. Requiring a count word keeps the amounts out
 * (unison_det, unison_detune, unison_pan_spread). */
const COUNT_LIKE = /voice_count|voices|polyphony/;

export function cellStyleFor(
    key: string, type: KnobParam['type'], min: number, max: number,
): { renderStyle: KnobParam['renderStyle']; signed?: boolean } {
    if (type === 'int' && min === 0 && max === 1) return { renderStyle: 'switch' };
    if (type !== 'int' || max - min < 2) return { renderStyle: 'arc' };
    const k = key.toLowerCase();
    /* A randomiser is an amount or an action, never the thing it names. */
    if (k.includes('rnd')) return { renderStyle: 'arc' };
    if (COUNT_LIKE.test(k) || k === 'unison') return { renderStyle: 'steps' };
    if (max - min > NARROW_RANGE_MAX) return { renderStyle: 'arc' };
    if (OCTAVE_LIKE.test(k) || (SIGNED_RANGE.test(k) && min < 0))
        return min < 0 ? { renderStyle: 'steps', signed: true } : { renderStyle: 'steps' };
    return { renderStyle: 'arc' };
}
