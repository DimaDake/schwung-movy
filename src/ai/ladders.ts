/* The three options' roles per creativity level (design §6, Settings →
 * GENERATORS). Option 1 is always the most careful of the three and option 3
 * the boldest; the level moves the whole ladder. Wording is about the chords
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

const VAR_MELODIC: Record<GenLevel, string[]> = {
    SAFE: ['Option 1: the closest B part: the same rhythm cell, moved to the next chords or a new register.',
        'Option 2: the same style with one clear change in rhythm, density or register.',
        'Option 3: a clearer change in rhythm and density that still keeps the feel.'],
    BALANCED: ['Option 1: the closest B part: same style, register and rhythmic feel, with a clear change that lets the song move on.',
        'Option 2: change the rhythm, density or register more boldly.',
        'Option 3: the most inventive B part.'],
    WILD: ['Option 1: a clear B part with a new rhythm.',
        'Option 2: change rhythm, density and register boldly.',
        'Option 3: the most inventive B part that still belongs to the song.'],
};

const VAR_DRUM: Record<GenLevel, string[]> = {
    SAFE: ['Option 1: the same pattern with a small change (a fill or one extra kick).',
        'Option 2: hats opening up or a kick placement change.',
        'Option 3: a clear pattern change that keeps the feel.'],
    BALANCED: ['Option 1: the same kit and feel with a clear pattern change (a fill, kick placement, hats opening up).',
        'Option 2: a bolder pattern change, for example a half-time or double-time feel.',
        'Option 3: the most inventive pattern that still keeps the kit and the style.'],
    WILD: ['Option 1: a bolder pattern change with a fill.',
        'Option 2: a half-time or double-time feel.',
        'Option 3: the most inventive pattern that still keeps the kit.'],
};

export function ladder(task: 'quantize' | 'variation', drum: boolean, level: GenLevel): string[] {
    const table = task === 'quantize' ? (drum ? QUANT_DRUM : QUANT_MELODIC) : (drum ? VAR_DRUM : VAR_MELODIC);
    return table[level];
}
