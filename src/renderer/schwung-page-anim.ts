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

/* THE SAME TWO FIELDS AS `SchwungLib`, picked rather than restated. A
 * hand-written `{ settled?: any; buttonPhase?: any }` typechecks against
 * anything carrying those names, so a rename over there would still compile and
 * this file would quietly stop being asked while every test stayed green.
 * Type-only, so esbuild erases it and no runtime import is created. */
type AnimSources = Pick<SchwungLib, 'settled' | 'buttonPhase'>;

/**
 * Build the per-tick predicate, resolved ONCE at binding time and guarded.
 *
 * An older Schwung serving a `param_pages` without these answers `false`, which
 * is precisely how the page behaved before SP-38 — the missing predicate costs
 * the feature rather than the tool, and the call site does not have to know.
 *
 * THE ONE COST THIS ADDS, and it is the failure to watch for. `settled` is
 * "nothing was stamped within the last 120 ms", and `observe` stamps whenever a
 * value's string DIFFERS from the last one it saw, so a key whose value moves
 * inside every 120 ms window never settles: `since` is re-stamped, `settled`
 * never returns true, and the page redraws forever at the full animating cost
 * (~0.7 ms/tick measured) instead of standing still. The threshold is a
 * FREQUENCY, not a per-frame change — the value has to move again within
 * 120 ms, i.e. faster than ~8 Hz. A 10 Hz LFO does it; a 2 Hz LFO does not.
 *
 * THE ROUTE TO IT IS A MODULATED OR `live` PARAM THE PAGE SHOWS, and this was
 * got wrong once, so the chain is written out. The renderer MERGES BEFORE IT
 * OBSERVES: `render_page_movy.mjs:2441` builds `liveValues = {...values,
 * ...modValues}`; the enum path hands `shown = liveRaw ?? raw` (`:2160`) into
 * `drawEnumSquare`, which calls
 * `observeLanded(anim, "enumw:" + key, shown, …)`
 * (`:1579`); the wave path passes `liveValues` into `drawVizGroup` (`:2516`)
 * and `drawWaveform` observes `values[key]` from it (`viz_draw.mjs:1115`). So
 * BOTH animated widgets observe the MODULATED value. `modValues` is refreshed
 * from `:effective` every tick (`page_controller.mjs:4148`, one key per tick —
 * `MOD_FAST_READS_PER_TICK`), and `modCache` (`:2344`) includes `live: true`
 * params, not only modulated ones. **A host LFO on an enum-shaped or wave-viz
 * param the drawn page shows is therefore a shipped route to a page that
 * redraws forever.** The arc knob is the only immune widget, and only because
 * `drawArcKnob` (`:1237`) takes no `anim` argument at all — NOT because of any
 * values/modValues split, which does not exist on the observe path.
 *
 * What is left outside that route: a jittery base enum, or a decoration feeding
 * a raw value back into an animated key such as `enumw:`. Decorations are
 * SP-36's territory, so **SP-36 must be checked against this predicate before
 * it ships** — but it is the second-order exposure, not the first.
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
         * A STILL PAGE IS CHEAP HERE, though not free: `observe` stamps a FIRST
         * sighting as ALREADY PAST, so every entry a drawn page leaves behind
         * is past its window and `settled` walks the map without returning
         * false. The map is NOT emptied — `anim_state` only ever sets, never
         * deletes, and the store outlives a page change — so a page that has
         * ever drawn an animated widget carries one entry per such key for the
         * rest of the session. That walk is a subtraction and a compare per
         * entry, which is why the idle measurement is unchanged; it is not
         * because there is nothing to walk. */
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
