import type { KnobParam } from '../types/param.js';

/* Pure inference for params whose type/range movy had to guess (float 0..1)
 * because the module published no chain_params entry and no hierarchy metadata
 * (KnobParam.metaGuessed). Mirrors how the enum layer learns its exchange format
 * once per param: on the first successful value read we look at the raw string
 * and, if it is plainly an integer control, switch the param to int and widen
 * its range to actually contain the value.
 *
 * Returns the fields to overwrite, or null when the guess should stand (a real
 * float in [0,1], or an unparseable value). */
export function inferGuessedMeta(
    p: Pick<KnobParam, 'type' | 'min' | 'max' | 'step'>,
    raw: string,
): Pick<KnobParam, 'type' | 'min' | 'max' | 'step'> | null {
    const v = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(v)) return null;

    // Integer control whose magnitude exceeds the 0..1 guess: infer int + range.
    if (Number.isInteger(v) && Math.abs(v) > 1) {
        // Negatives are almost always symmetric bipolar controls (transpose,
        // detune): mirror the magnitude so 0 stays centred. Positives get the
        // smallest power-of-two bound ≥ value — enough to contain it without
        // over-claiming a 0..127 MIDI range we can't actually confirm.
        const min = v < 0 ? v : 0;
        const max = v < 0 ? -v : pow2AtLeast(v);
        return { type: 'int', min, max, step: 1 };
    }

    // A genuine fractional value in the guessed range: keep the guess.
    return null;
}

function pow2AtLeast(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}
