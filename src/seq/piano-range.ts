/* Which keys the held-step piano shows (seq/step-piano.ts).
 *
 * The keyboard is laid out as equal semitone SLOTS along its top edge — black
 * and white keys the same width there — so the zoom is one number, the slot
 * width `k`, and the range is however many slots fit the screen. 5 px is two
 * octaves C..C; each narrower slot buys more keys for a wide chord.
 *
 * The window is sticky on purpose: a keyboard that re-centres on every note
 * added makes you hunt for the keys you were just looking at. */

export const PIANO_W = 128;
/** Widest first: the first one that fits the notes wins. */
export const SLOT_WIDTHS = [5, 4, 3, 2];

export interface PianoWindow {
    /** Lowest key shown — always a C. */
    lo: number;
    /** Slot width in px, its left line included. */
    k: number;
    /** Keys shown; the last one is always a white key. */
    n: number;
}

export function isBlackKey(m: number): boolean {
    const pc = ((m % 12) + 12) % 12;
    return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
}

/* `n * k + 1` px: n slots plus the closing right edge. A black key at the
 * right edge would be half a key with no white key under it, so it is dropped. */
export function windowAt(lo: number, k: number): PianoWindow {
    let n = Math.min(Math.floor((PIANO_W - 1) / k), 128 - lo);
    while (n > 1 && isBlackKey(lo + n - 1)) n--;
    return { lo, k, n };
}

function contains(w: PianoWindow, min: number, max: number): boolean {
    return min >= w.lo && max <= w.lo + w.n - 1;
}

function octaveFloor(m: number): number {
    return Math.max(0, Math.floor(m / 12) * 12);
}

/* The widest-key window that holds [min, max], starting on the C at or below
 * `min` and shifted down by whole octaves to centre the notes when there is
 * room — a lone note would otherwise sit on the left edge. Rounding half the
 * spare room to an octave never pushes `max` out: 12 * round(spare / 24) is
 * at most `spare` whenever it is not zero. */
function fresh(min: number, max: number, kCap: number): PianoWindow {
    const lo0 = octaveFloor(min);
    let k = SLOT_WIDTHS[SLOT_WIDTHS.length - 1];
    for (const c of SLOT_WIDTHS) {
        if (c <= kCap && contains(windowAt(lo0, c), min, max)) { k = c; break; }
    }
    const w = windowAt(lo0, k);
    const spare = w.lo + w.n - 1 - max;
    const lo = Math.max(0, lo0 - 12 * Math.round(spare / 24));
    return windowAt(lo, k);
}

/**
 * The window for `notes`.
 * - `prev`: what was shown last for this track (null the first time).
 * - `anchor`: the pitch to centre on when the step is empty.
 * - `holding`: the same hold as `prev` — the range may grow but never shrink,
 *   so it does not jump about while a chord is being built.
 */
export function fitWindow(notes: readonly number[], prev: PianoWindow | null,
                          anchor: number, holding: boolean): PianoWindow {
    if (notes.length === 0) {
        if (holding && prev) return prev;     // every note removed mid-hold
        notes = [anchor];
    }
    let min = 127, max = 0;
    for (const p of notes) { if (p < min) min = p; if (p > max) max = p; }
    const best = fresh(min, max, SLOT_WIDTHS[0]);
    /* Between holds the last window survives only at the zoom the notes would
     * get anyway: stepping through similar chords keeps still, but a wide
     * chord's dense keys are not inherited by the next, narrower step. */
    if (prev && contains(prev, min, max) && (holding || prev.k === best.k)) return prev;
    return holding && prev && prev.k < best.k ? fresh(min, max, prev.k) : best;
}
