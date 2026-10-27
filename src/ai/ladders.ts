/* The options' roles per creativity level (design §6, Settings →
 * GENERATORS). Smart Quantize: option 1 is always the most careful of the
 * three and option 3 the boldest; the level moves the whole ladder. Wording is about the chords
 * the other tracks sound, never about a scale. */

export type GenLevel = 'SAFE' | 'BALANCED' | 'WILD';
export const GEN_LEVELS: GenLevel[] = ['SAFE', 'BALANCED', 'WILD'];

/* One temperature for every level: the bench (plans/gen-bench-results-
 * 2026-10-27-level-*.md) found 0.7 made SAFE no safer and 1.3 made WILD no
 * bolder, only less reliable; the ladder wording is what moves the options. */
export const LEVEL_TEMPERATURE: Record<GenLevel, number> = { SAFE: 1.0, BALANCED: 1.0, WILD: 1.0 };

const CLOSEST = 'move onsets onto the groove of the other tracks (keep deliberate swing or push) and change a pitch '
    + 'only where it clashes with the chord sounding at that moment; keep every other note as played.';

const QUANT_MELODIC: Record<GenLevel, string[]> = {
    SAFE: [`Option 1 (closest): ${CLOSEST}`,
        'Option 2 (tidy): as option 1, and also remove accidental double hits and ghost notes, and even out velocity and note lengths.',
        'Option 3 (light): tidy, plus one light touch of development: a passing note, a small rhythmic answer or a voicing tweak.'],
    BALANCED: [`Option 1 (closest): ${CLOSEST}`,
        'Option 2 (shaped): develop the idea: re-voice or fill out chords, use inversions, tighten the rhythm against drums and bass, '
            + 'remove accidental ghost notes and double hits.',
        'Option 3 (inspired): use the idea as a seed: reharmonise with chords that still fit the other tracks, borrow rhythmic ideas '
            + 'from other tracks, answer or extend the phrase. It must still be recognisably the same idea.'],
    WILD: ['Option 1 (developed): tighten to the groove, re-voice, and add passing and approach notes.',
        'Option 2 (reshaped): new rhythmic placement and different voicings, or a borrowed chord where the other tracks allow it.',
        'Option 3 (reimagined): keep only the core of the motif (its main interval or rhythm cell) and build a bold new part around it.'],
};

const QUANT_DRUM: Record<GenLevel, string[]> = {
    SAFE: ['Option 1 (closest): fix timing and velocity only, and keep every hit on the same pad (same pitch).',
        'Option 2 (tidy): tighten to the other tracks\' groove and remove accidental flams and double hits.',
        'Option 3 (light): as option 2, with a few accents and one or two ghost notes.'],
    BALANCED: ['Option 1 (closest): fix timing and velocity only, and keep every hit on the same pad (same pitch).',
        'Option 2 (shaped): tighten the groove to the other tracks, add or remove ghost notes, shape velocity accents.',
        'Option 3 (inspired): a bolder take on the groove: accents, ghost notes, feel.'],
    WILD: ['Option 1 (developed): tighten, then add ghost notes and accents.',
        'Option 2 (reshaped): reshape the groove: move kicks, open hats, add a fill.',
        'Option 3 (reimagined): a bold new pattern grown from the played hits.'],
};

/* Variation's eight (plans/2026-10-27-variation-eight-options.md): 1-4 stay
 * close (the source's rhythm and role, other notes), 5-6 change the rhythm or
 * the connections, 7-8 are experimental. The level moves only 7-8: the user
 * picks how far to go by picking an option, so the close ones stay close. */
const VAR_MELODIC = [
    'Option 1 (next chords): keep the source\'s rhythm exactly; new pitches that fit the chords of the [TARGET] scene.',
    'Option 2 (re-voiced): keep the rhythm; a new voicing: other inversions and spacing for chords, a new contour for a '
        + 'line (where the source rises, fall).',
    'Option 3 (new line): keep the rhythmic feel and density; a new line or chord choice from the chord tones that answers '
        + 'the source like a second phrase.',
    'Option 4 (answer): the first half stays close to the source, the second half ends somewhere new (call and response).',
    'Option 5 (rhythm): the source\'s pitches and role with a new rhythmic placement: syncopation, a chord change '
        + 'anticipated by an 8th, displaced accents.',
    'Option 6 (connections): different connections between the chords: passing and approach notes, suspensions that '
        + 'resolve, smooth voice leading into each change, as far as the role allows.',
];

const VAR_MELODIC_EXP: Record<GenLevel, string[]> = {
    SAFE: ['Option 7 (colour): one borrowed chord or chromatic colour where the other tracks allow it.',
        'Option 8 (motif): keep the main interval or rhythm cell of the source and build a new phrase around it.'],
    BALANCED: ['Option 7 (colour): borrowed chords, modal or chromatic colour where the other tracks allow it.',
        'Option 8 (reimagined): keep only the core cell (main interval or rhythm motif) and build a bold new part around it.'],
    WILD: ['Option 7 (colour): bold colour: borrowed and chromatic chords, unexpected but resolving.',
        'Option 8 (reimagined): the boldest new part grown from the core cell of the source.'],
};

const VAR_DRUM = [
    'Option 1 (kick): the same groove with a different kick pattern: one or two kicks moved or added.',
    'Option 2 (hats): the same groove with a new hat and percussion line (open hats, a different hat rhythm).',
    'Option 3 (accents): the same groove with ghost notes and accents shaped differently.',
    'Option 4 (fill): the same groove with a fill in the last bar.',
    'Option 5 (rhythm): the accents displaced: a syncopated kick or a moved snare or clap, about the same density.',
    'Option 6 (connections): a turnaround at the end of every second bar, so the bars lead into each other.',
];

const VAR_DRUM_EXP: Record<GenLevel, string[]> = {
    SAFE: ['Option 7 (feel): a half-time feel on the same pads.',
        'Option 8 (new): a new pattern grown from the played hits, close in density.'],
    BALANCED: ['Option 7 (feel): a half-time or double-time feel.',
        'Option 8 (new): a new pattern grown from the played hits.'],
    WILD: ['Option 7 (feel): a half-time or double-time feel with a broken, syncopated kick.',
        'Option 8 (new): the boldest pattern grown from the played hits.'],
};

const VAR_GROUPS = 'Options 1-4 stay close to the source; 5-6 change its rhythm or connections; 7-8 are experimental. '
    + 'All eight keep the ROLE and stay musical.';

/** How many options a task asks for and the preview offers. */
export function optionCount(task: 'quantize' | 'variation'): number { return task === 'quantize' ? 3 : 8; }

export function ladder(task: 'quantize' | 'variation', drum: boolean, level: GenLevel): string[] {
    if (task === 'quantize') return (drum ? QUANT_DRUM : QUANT_MELODIC)[level];
    return [VAR_GROUPS, ...(drum ? [...VAR_DRUM, ...VAR_DRUM_EXP[level]] : [...VAR_MELODIC, ...VAR_MELODIC_EXP[level]])];
}
