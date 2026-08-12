/* How far one physical detent moves a knob's value. Split out of store.ts so
 * the rule is stated once and can be asserted against real module metadata
 * (browser-test/dump-replay.mjs) without driving a whole model. */
import type { KnobParam } from '../types/param.js';
import { ARC_DELTA_SCALE, ENUM_DELTA_DIV, MIN_STEP_RANGE_FRAC } from './constants.js';

/* A range this narrow or narrower is stepped rather than swept. */
export const NARROW_RANGE_MAX = 8;

/* Physical clicks per value step. A handful of discrete values spread across a
 * whole knob is a hair trigger — one click crossing a quarter of an octave
 * param's range is what made it "too fast in the middle" — so a narrow int is
 * stepped at the same rate as the enum knobs (ENUM_DELTA_DIV), which is what a
 * module that publishes its octave AS an enum already feels like.
 *
 * A range of 1 is an on/off switch drawn as a bar: it never had the fractional
 * step problem below, and a switch needing four clicks to flip is worse than the
 * hair trigger, so it is left alone. 'wide' acceleration owns its own rate. */
export function detentsPerStep(p: KnobParam): number {
    if (p.type !== 'int' || p.knobAcceleration === 'wide') return 1;
    const range = p.max - p.min;
    return range >= 2 && range <= NARROW_RANGE_MAX ? ENUM_DELTA_DIV : 1;
}

/* Per-detent movement in the param's own units, for the continuous branch of
 * applyKnobDelta (enums and 'wide' acceleration have their own step rules).
 *
 * Normalize to a fraction of the range so every knob takes a consistent sweep
 * regardless of units — a wide range (reso 0.5..20) isn't crawling and a narrow
 * one isn't hair-trigger. Int: keep its natural (usually integer) step as a
 * floor so discrete values still move.
 *
 * An int's step must then be a WHOLE number of units, because store.ts rounds
 * the value it keeps and the remainder is dropped rather than carried to the
 * next detent. A fractional step therefore made a turn's distance depend on how
 * many detents the host happened to batch into one tick (3 batched detents of
 * 0.5 moved 2 units, 3 separate ones moved 3), and `Math.round` breaks the .5
 * tie upward — so a half-unit step advanced by 1 clockwise and by NOTHING
 * counter-clockwise. That is every int with a range <= 200 (obxd octave and
 * cutoff among them): 257 of the dumped fleet's 464 int params. Rounding the
 * step preserves what a single clockwise detent already did and makes both
 * directions, and every batch size, match it.
 */
export function perDetentStep(p: KnobParam): number {
    const arcScale = p.renderStyle === 'arc' ? ARC_DELTA_SCALE : 1;
    if (p.max <= p.min) return p.step * arcScale;   // unturnable; the clamp pins it anyway
    const rangeStep = (p.max - p.min) * MIN_STEP_RANGE_FRAC;
    if (p.type === 'int')   return Math.round(Math.max(p.step, rangeStep) * arcScale);
    if (p.type === 'float') return rangeStep * arcScale;
    return p.step * arcScale;
}
