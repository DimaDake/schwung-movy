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

/** The two library functions this asks, both optional — see `SchwungLib`. */
export interface AnimSources {
    settled?:     any;
    buttonPhase?: any;
}

/**
 * Build the per-tick predicate, resolved ONCE at binding time and guarded.
 *
 * An older Schwung serving a `param_pages` without these answers `false`, which
 * is precisely how the page behaved before SP-38 — the missing predicate costs
 * the feature rather than the tool, and the call site does not have to know.
 *
 * THE ONE COST THIS ADDS, and it is the failure to watch for. `settled` is
 * "nothing was stamped within the last 120 ms", and `observe` stamps whenever a
 * value's string DIFFERS from the last one it saw. So a key whose value string
 * differs on EVERY render never settles: `since` is re-stamped each tick,
 * `settled` never returns true, and the page redraws forever at the full
 * animating cost (~0.7 ms/tick measured) instead of standing still. It is NOT
 * a value that merely changes often — that is the feature. It has to change
 * between the render and the very next render, with no quiet tick at all.
 *
 * WHAT CANNOT DO IT, checked rather than assumed: a modulated knob. Effective
 * (`:effective`) values travel to the renderer through `modValues`, not
 * `values`, so an LFO or automation lane sweeping a parameter does not touch
 * the map `settled` reads. The residual exposure is therefore a jittery or
 * `live` BASE enum (a key whose raw string is re-rendered non-deterministically,
 * e.g. a noise or meter readout), or a decoration that feeds a raw value back
 * into an animated key such as `enumw:`. **A decoration is the one plausible
 * route, and decorations are SP-36's territory** — whatever SP-36 lands must be
 * checked against this predicate before it ships.
 */
export function createPageAnimating(
    ctl: any,
    lib: AnimSources,
): (nowMs: number) => boolean {
    const animSettled = typeof lib.settled === 'function' ? lib.settled : null;
    const bangPhase = typeof lib.buttonPhase === 'function' ? lib.buttonPhase : null;

    return function animating(nowMs: number): boolean {
        /* 1. A WIDGET TRANSITION. `ctl.state.anim` is the store the renderer
         * feeds, so `settled` here and the renderer's own observation are the
         * same map read by the same rule — movy never needs to build the store,
         * only to ask it.
         *
         * A STILL PAGE COSTS NOTHING HERE: `observe` stamps a FIRST sighting as
         * already past, so once a page has been drawn its map holds only
         * transitions that have started since, and an idle page iterates an
         * empty map. That is the whole reason the idle cost is unchanged. */
        if (animSettled && !animSettled(ctl.state && ctl.state.anim, nowMs)) return true;
        /* 2. THE TRIGGER BANG, which is time-driven the same way and has no
         * value change to announce it. The list is passed to `buttonPhase`
         * exactly as the renderer passes it (`render_page_movy.mjs:2617`), so
         * the flash duration is asked of its one definition rather than
         * restated — and `BTN_FLASH_MS` moving upstream moves both.
         *
         * The map only holds keys that have FIRED, so a page that has never
         * fired a trigger allocates nothing and loops zero times. */
        const fired = bangPhase && ctl.triggerFiredAt;
        if (!fired) return false;
        for (const k in fired) {
            const stamps = fired[k];
            if (stamps && stamps.length
                && bangPhase(stamps, nowMs, false).bursts.length) return true;
        }
        return false;
    };
}
