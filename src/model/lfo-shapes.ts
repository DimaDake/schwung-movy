/* Maps an LFO shape option NAME to a shapeSample id (see renderer/lfo-wave.ts).
 * Module LFO enums list their shapes in arbitrary order and vocabulary, so the
 * viz resolves the current option by name rather than by raw index. Ids:
 *   0 sine  1 tri  2 saw-up  3 square  4 s&h  5 smooth-random
 *   6 saw-down  7 noise  8 envelope glyph  9 staircase glyph  10 generic
 *   11 stepped ramp  12 stepped triangle  13 pulse  14 pw-square  15 ring
 *   16 wavetable  17 warp  18 sink  19 off (flat)
 * Returns null when a name is not a shape at all (so a non-shape enum — e.g. a
 * clock-division or Off/On list — fails the "is this a shape enum?" test). */

/* Three names moved out of their original slots: `random` was 4 (s&h),
 * `pulse`/`warmpulse` were 3 (square), and `warp`/`sink` were 0 (sine). Each
 * moved because some module lists BOTH members of the pair — signal:mod_shape
 * has S&H and Random, aphex:v2_wave has Square and Pulse, ambiotica:mod_shape
 * has Sine, Warp and Sink — and a silhouette that draws two options identically
 * is worse than the abbreviation it replaces. */
const NAMED: Record<string, number> = {
    sine: 0, sin: 0, skewedsine: 0,
    tri: 1, triangle: 1,
    saw: 2, sawtooth: 2, rampup: 2, softsaw: 2, sawup: 2, ramp: 2,
    square: 3, sqr: 3, squ: 3, rect: 3, softsquare: 3,
    sh: 4, samplehold: 4, rnd1: 4, rand: 4, 's+h': 4,
    smoothrandom: 5, sg: 5, rnd2: 5, drift: 5, sampleglide: 5, random: 5, rnd: 5,
    rampdown: 6, sawdown: 6,
    noise: 7,
    envelope: 8,
    stepsequencer: 9, step: 9,
    mseg: 10, formula: 10,
    pulse: 13, pulsetr: 13, warmpulse: 13,
    'pw-square': 14,
    ring: 15,
    wavetable: 16,
    warp: 17,
    sink: 18,
    off: 19,
};

/* Level count encoded into the id for the stepped families. Kept well clear of
 * the hand-drawn ids (0-19) so both stay readable in logs and tests. */
export const STEP_BASE = 100, PYR_BASE = 200;
/* 2 is the floor: the samplers divide by (n-1), and a one-level "staircase"
 * is a flat line, not a shape. 99 keeps a count inside its own id range. */
const clampCount = (digits: string): number =>
    Math.max(2, Math.min(99, parseInt(digits, 10) || 2));

const norm = (name: string): string => name.toLowerCase().replace(/[&\s_]+/g, '');

/* Shape id for an option name, or null when it is not a shape. Digital wavetable
 * entries ("Wave 3", "Wave 62") and unknown-but-shape-shaped names collapse to
 * the generic squiggle (10) only via shapeIdOrGeneric; here they stay null so a
 * non-shape enum can be told apart from a shape enum with exotic entries. */
export function shapeId(name: string): number | null {
    const n = norm(name);
    if (n in NAMED) return NAMED[n];
    if (/^wave\d+$/.test(n)) return 10;   // Osirus/Virus digital wavetables
    /* Helm's stepped families: "N Step" climbs in levels, "N Pyramid" climbs
     * and falls. The COUNT is encoded in the id, because without it 3/4/8 Step
     * all draw the same picture — and a silhouette standing for three different
     * waveforms is exactly what the uniqueShape rule exists to prevent.
     * Counting the levels is not the point (nobody counts 8 steps in 12px);
     * telling a stepped climb from the list's own smooth "Saw Up" is, and that
     * needs the full cell height (see drawWaveSquare). */
    const step = /^(\d+)step$/.exec(n);
    if (step) return STEP_BASE + clampCount(step[1]);
    const pyr = /^(\d+)pyramid$/.exec(n);
    if (pyr) return PYR_BASE + clampCount(pyr[1]);
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
