/* Maps an LFO shape option NAME to a shapeSample id (see renderer/lfo-wave.ts).
 * Module LFO enums list their shapes in arbitrary order and vocabulary, so the
 * viz resolves the current option by name rather than by raw index. Ids:
 *   0 sine  1 tri  2 saw-up  3 square  4 s&h  5 smooth-random
 *   6 saw-down  7 noise  8 envelope glyph  9 staircase glyph  10 generic
 * Returns null when a name is not a shape at all (so a non-shape enum — e.g. a
 * clock-division or Off/On list — fails the "is this a shape enum?" test). */

const NAMED: Record<string, number> = {
    sine: 0, sin: 0, skewedsine: 0, sink: 0, warp: 0,
    tri: 1, triangle: 1,
    saw: 2, sawtooth: 2, rampup: 2, softsaw: 2,
    square: 3, sqr: 3, squ: 3, rect: 3, pulse: 3, warmpulse: 3, softsquare: 3,
    sh: 4, samplehold: 4, rnd1: 4, random: 4,
    smoothrandom: 5, sg: 5, rnd2: 5, drift: 5,
    rampdown: 6, sawdown: 6,
    noise: 7,
    envelope: 8,
    stepsequencer: 9, step: 9,
    mseg: 10, formula: 10,
};

const norm = (name: string): string => name.toLowerCase().replace(/[&\s_]+/g, '');

/* Shape id for an option name, or null when it is not a shape. Digital wavetable
 * entries ("Wave 3", "Wave 62") and unknown-but-shape-shaped names collapse to
 * the generic squiggle (10) only via shapeIdOrGeneric; here they stay null so a
 * non-shape enum can be told apart from a shape enum with exotic entries. */
export function shapeId(name: string): number | null {
    const n = norm(name);
    if (n in NAMED) return NAMED[n];
    if (/^wave\d+$/.test(n)) return 10;   // Osirus/Virus digital wavetables
    return null;
}

/* Draw-time id: a qualifying shape enum whose current option is unmapped still
 * draws — as the generic squiggle — rather than dropping the viz mid-scroll. */
export const shapeIdOrGeneric = (name: string | undefined): number =>
    (name === undefined ? 10 : (shapeId(name) ?? 10));

/* An enum is a shape list when at least half its options resolve to a shape. */
export function isShapeEnum(options: string[] | null | undefined): boolean {
    if (!options || options.length === 0) return false;
    const hits = options.filter(o => shapeId(o) !== null).length;
    return hits * 2 >= options.length;
}
