/* schwung-page-anim.ts — "is the drawn page still moving?", asked once per tick.
 *
 * SP-38. Schwung's renderer is pure and time is passed in: `page_controller`
 * hands every draw `anim: s.anim` and `nowMs: now()`, and each animated widget
 * guards on `anim && typeof nowMs === "number"`. So the frames exist only if
 * someone renders AGAIN — upstream's host redraws unconditionally, movy's
 * `page-poll.ts` repaints only on a change, and an animation that changes
 * nothing for 100-300 ms therefore gets one frame and freezes halfway.
 *
 * This module is the second question that decision asks. It lives apart from
 * the binding because it is the only part of that file that reads the STORE
 * rather than the controller, and because the binding crossed the 200-line cap
 * the moment it landed.
 */

import type { SchwungLib } from './schwung-lib.js';

/** What the drawn page's animation store says this tick: a one-shot
 *  transition in flight (`moving`), or a key that never rests (`streaming`). */
export interface AnimActivity { moving: boolean; streaming: boolean }

export const STILL: AnimActivity = Object.freeze({ moving: false, streaming: false });

/* THE SAME TWO FIELDS AS `SchwungLib`, picked rather than restated. A
 * hand-written `{ activity?: any; buttonPhase?: any }` typechecks against
 * anything carrying those names, so a rename over there would still compile and
 * this file would quietly stop being asked while every test stayed green.
 * Type-only, so esbuild erases it and no runtime import is created. */
type AnimSources = Pick<SchwungLib, 'activity' | 'buttonPhase'>;

/**
 * Build the per-tick predicate, resolved ONCE at binding time.
 *
 * A NEVER-RESTING KEY IS A STREAM, NOT A TRANSITION, and the store now says
 * which. The route to one is a modulated or `live` param the page shows: the
 * renderer merges `modValues` over `values` BEFORE it observes, so both
 * animated widgets (the enum square's `enumw:` and the waveform) observe the
 * DRIVEN value, refreshed from `:effective` every tick. A host LFO on such a
 * param moves it faster than its transition duration forever. `activity()`
 * (Schwung #543, SU-11) reports that as `streaming` and a real 100-300 ms
 * transition as `moving`, so `repaint-cap.ts` throttles the first and never
 * the second. The arc knob stays immune: `drawArcKnob` takes no `anim`.
 */
export function createPageAnimating(
    ctl: any,
    lib: AnimSources,
): (nowMs: number) => AnimActivity {
    const activity = typeof lib.activity === 'function' ? lib.activity : null;
    const bangPhase = typeof lib.buttonPhase === 'function' ? lib.buttonPhase : null;

    return function animating(nowMs: number): AnimActivity {
        /* 1. THE WIDGET STORE. `ctl.state.anim` is the store the renderer
         * feeds, so this and the renderer's own observation are the same map
         * read by the same rule — movy never builds the store, only asks it. */
        const a: AnimActivity = activity ? activity(ctl.state && ctl.state.anim, nowMs) : STILL;
        if (a.moving) return a;
        /* 2. THE TRIGGER BANG, which is time-driven the same way and has no
         * value change to announce it — a one-shot, so it is `moving`. The list
         * is passed to `buttonPhase` exactly as the renderer passes it, so the
         * flash duration is asked of its one definition rather than restated.
         *
         * The map only holds keys that have FIRED, so a page that has never
         * fired a trigger allocates nothing and loops zero times. */
        const fired = bangPhase && ctl.triggerFiredAt;
        if (!fired) return a;
        for (const k in fired) {
            const stamps = fired[k];
            if (stamps && stamps.length
                && bangPhase(stamps, nowMs, false).bursts.length) {
                return { moving: true, streaming: a.streaming };
            }
        }
        return a;
    };
}
