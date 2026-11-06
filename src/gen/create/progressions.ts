/* New Clip's named progressions, the seeds HARMONY's map grows from
 * (create/plans.ts): degrees of the key (0 = tonic), and colour as semitones
 * over the tonic. Grouped by how many chords a 4-bar phrase moves through:
 * HARMONY lays them as sections, 2 then 4 then 8 (user, 2026-11-06: "2
 * chords harmony options before 4 chords and enough options for 8 chords
 * after"). */

import type { Quality } from '../types.js';

export type Prog = [string, number[], boolean?];   // name, degrees (0 = tonic), sevenths
export type Colour = [string, [number, Quality][]];

export const MAJOR: Prog[] = [
    ['POP', [0, 4, 5, 3]], ['DOO-WOP', [0, 5, 3, 4]], ['CADENCE', [0, 3, 4, 0]], ['II-V-I', [1, 4, 0, 0], true],
    ['VAMP', [0, 3, 0, 3]], ['LIFT', [3, 4, 5, 5]], ['SOUL', [0, 2, 3, 4], true], ['TONIC', [0, 0, 0, 0]],
];
export const MINOR: Prog[] = [
    ['MINOR LOOP', [0, 5, 2, 6]], ['DESCENT', [0, 6, 5, 4]], ['CADENCE', [0, 3, 4, 0]], ['DRIFT', [0, 6, 5, 6]],
    ['VAMP', [0, 3, 0, 3]], ['EPIC', [0, 5, 6, 0]], ['DEEP', [0, 3, 6, 2], true], ['TONIC', [0, 0, 0, 0]],
];

/* More of the loops in the key (user, 2026-10-29: "more harmony options for
 * chord generators on new scenes"), after the first eight so those keep
 * their positions. Diatonic, so a take may open on them. */
export const MORE_MAJOR: Prog[] = [
    ['SENSITIVE', [5, 3, 0, 4]], ['ROYAL ROAD', [3, 4, 2, 5]], ['TURNAROUND', [0, 5, 1, 4]], ['SWAY', [0, 1, 0, 1], true],
];
export const MORE_MINOR: Prog[] = [
    ['HOOK', [0, 2, 6, 5]], ['RISE', [5, 6, 0, 0]], ['SHUTTLE', [0, 6, 0, 6]], ['FALL', [0, 4, 5, 2], true],
];

/* Borrowed and modal colour, chords from outside the key: the end of a
 * section, for a more experimental take (user: "extended ranges add more
 * experimental flavor"). Never drawn for a take. */
export const COLOUR_MAJOR: Colour[] = [
    ['MIXOLYDIAN', [[0, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']]], ['MINOR IV', [[0, 'maj'], [5, 'maj'], [5, 'min'], [0, 'maj']]],
    ['BVI BVII', [[8, 'maj'], [10, 'maj'], [0, 'maj'], [0, 'maj']]], ['BACKDOOR', [[2, 'm7'], [10, '7'], [0, 'maj7'], [0, 'maj7']]],
    ['LYDIAN', [[0, 'maj'], [2, 'maj'], [0, 'maj'], [2, 'maj']]],
];
export const COLOUR_MINOR: Colour[] = [
    ['DORIAN', [[0, 'min'], [5, 'maj'], [0, 'min'], [5, 'maj']]], ['PHRYGIAN', [[0, 'min'], [1, 'maj'], [0, 'min'], [1, 'maj']]],
    ['HARMONIC', [[0, 'min'], [5, 'min'], [7, 'maj'], [0, 'min']]], ['ANDALUSIAN', [[0, 'min'], [10, 'maj'], [8, 'maj'], [7, 'maj']]],
    ['PICARDY', [[0, 'min'], [5, 'min'], [10, 'maj'], [0, 'maj']]],
];

/* Eight-chord progressions: a bar each on a long clip (the 4 section), a
 * half-bar each in the 8 section. */
export const LONG_MAJOR: Prog[] = [['CIRCLE', [0, 3, 6, 2, 5, 1, 4, 0]], ['CANON', [0, 4, 5, 2, 3, 0, 3, 4]], ['ROAD', [0, 5, 3, 4, 0, 2, 3, 4]]];
export const LONG_MINOR: Prog[] = [['CIRCLE', [0, 3, 6, 2, 5, 1, 4, 0]], ['LAMENT', [0, 6, 5, 4, 3, 2, 4, 4]], ['SAGA', [0, 5, 2, 6, 0, 3, 5, 4]]];

/* Two-chord vamps, two bars a chord: the pairs pop and dance tracks sit on,
 * both ways round where the other way is common too. */
export const PAIR_MAJOR: Prog[] = [
    ['I-IV', [0, 3]], ['I-V', [0, 4]], ['I-VI', [0, 5]], ['VI-IV', [5, 3]], ['IV-V', [3, 4]], ['II-V', [1, 4], true],
    ['I-II', [0, 1], true], ['IV-I', [3, 0]], ['VI-V', [5, 4]], ['I-III', [0, 2]],
];
export const PAIR_MINOR: Prog[] = [
    ['I-VII', [0, 6]], ['I-VI', [0, 5]], ['I-IV', [0, 3]], ['VI-VII', [5, 6]], ['I-V', [0, 4]], ['IV-V', [3, 4]],
    ['I-III', [0, 2]], ['VI-I', [5, 0]], ['III-VII', [2, 6]], ['IV-I', [3, 0], true],
];
export const PAIR_COLOUR_MAJOR: Colour[] = [
    ['MIXOLYDIAN', [[0, 'maj'], [10, 'maj']]], ['LYDIAN', [[0, 'maj'], [2, 'maj']]], ['MINOR IV', [[0, 'maj'], [5, 'min']]],
    ['BVI', [[0, 'maj'], [8, 'maj']]],
];
export const PAIR_COLOUR_MINOR: Colour[] = [
    ['DORIAN', [[0, 'min'], [5, 'maj']]], ['PHRYGIAN', [[0, 'min'], [1, 'maj']]], ['HARMONIC', [[0, 'min'], [7, 'maj']]],
    ['DORIAN 7', [[0, 'm7'], [5, '7']]],
];
