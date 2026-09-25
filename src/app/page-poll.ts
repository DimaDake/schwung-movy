/* page-poll.ts — the per-tick half of a delegated page, and why it is per-tick.
 *
 * SP-12 of the Schwung page migration. movy's own `refreshOneParam` stops for a
 * component Schwung draws — that is the whole item — and stopping it takes two
 * things with it that nothing else was providing:
 *
 *   1. THE POLL. `owner.poll()` is what advances the delegated page's contract
 *      and its one-key-per-tick read cursor, and its only caller was the render
 *      path. The render path ran because `refreshOneParam` dirtied the model
 *      every few ticks. So the naive version of this item is a deadlock:
 *
 *        no refresh -> model never dirty -> no frame -> no poll ->
 *        the page never reads -> its values freeze -> nothing dirties
 *
 *      Measured, not reasoned: before the poll moved out of the render branch,
 *      a parameter changed behind both readers' backs was picked up by movy in
 *      the `off` arm and by NOBODY in the `page` arm.
 *
 *   2. THE REPAINT SIGNAL. `refreshOneParam` sets `dirty` unconditionally, so
 *      movy repainted on a refresh cadence whether anything had moved or not.
 *      What replaces it is narrower and truer: the drawn cells' own values. A
 *      lane, an LFO or the page's own cursor moving one of them is what asks
 *      for the frame back now.
 *
 *      SP-38 ADDED THE ONE CASE VALUES CANNOT SEE. A value change is an
 *      INSTANT, and Schwung's animated widgets — the enum square's frame
 *      travelling to the option's new width, the waveform morphing shape, a
 *      trigger bang flashing out — spend the next 100-300 ms DRAWING the
 *      transition that value change started. Nothing changes again during it,
 *      so a values-only test renders one frame at the instant of the change and
 *      then freezes the widget halfway. `page.animating()` is the second
 *      question, and it is asked only when the first two answered no, so a page
 *      whose values are moving is decided exactly as it was before.
 *
 * THE POLL IS NOT UNCONDITIONAL, and that is deliberate. A poll is a read, and a
 * page nobody is addressing is a page whose contract is being re-planned and
 * whose cursor is being advanced for no one, on a view the user may not open for
 * minutes. It used to be worse than waste — the retry budget was finite with no
 * recovery once spent (Cause D, SP-15), so polling while movy sat on the
 * sequencer gave the page up before the user ever opened it. SP-15 made the
 * asking survive; it did not make it free, and a contract that has asked its way
 * through the eager window settles slowly for whoever opens it next. The guard
 * is therefore exactly the condition under which the module grid is what the
 * knobs are addressing, and `app/tick.ts` derives the BODY from the same call,
 * so the two cannot drift.
 */

import { appState, VIEW_KNOBS, VIEW_CHAIN, VIEW_CLIP_PARAMS, VIEW_MAIN_PARAMS } from './state.js';
import { seqState } from '../seq/state.js';
import { sessionReady } from '../seq/set-session.js';
import { schwungEditorActive } from '../renderer/schwung-editor.js';
import type { PageOwner } from './page-owner.js';
import { perfPhase, perfPhaseEnd } from './perf-probe.js';
import { createRepaintCap } from './repaint-cap.js';

/**
 * Is the module grid what the eight knobs are addressing?
 *
 * Mirrors the two branches of `app/tick.ts`'s view ladder that draw a module's
 * parameters, and the modal cases that sit in FRONT of them there: the loading
 * splash and Schwung's own dive editor. Every other branch is a different
 * `currentView` and so is excluded by the test itself.
 *
 * SESSION MODE HAS NO `currentView` OF ITS OWN (SP-52). `appState.currentView`
 * keeps whatever it held before Session was entered — `masterDetail`, not
 * `currentView`, is what tells the master GRID (a chain view, no param page
 * under it) from the master DETAIL page (a real module's knob page, same
 * shape as a track slot's). So session mode answers off `masterDetail` instead
 * of falling through to the `currentView` test below, which it would pass or
 * fail by accident depending on whatever view was on screen when Session was
 * opened.
 *
 * SET/CLIP PARAMS ARE A THIRD AND FOURTH GRID (SP-53) — pages with no module
 * behind them, but still ones Schwung may plan and draw under the flag.
 * Tested here rather than folded into the `VIEW_KNOBS`/`VIEW_CHAIN` pair so
 * a further virtual page is one more `||`, not a second question.
 */
export function moduleGridOnScreen(): boolean {
    if (!sessionReady() || schwungEditorActive()) return false;
    if (seqState.sessionMode) return appState.masterDetail;
    if (appState.currentView === VIEW_CLIP_PARAMS || appState.currentView === VIEW_MAIN_PARAMS) return true;
    return appState.currentView === VIEW_KNOBS || appState.currentView === VIEW_CHAIN;
}

/* The drawn cells as of this tick. Module-level because it is read again at
 * render time — the LED row is lit from the same eight numbers that decided the
 * frame was worth drawing, so the ring can never show a page the screen does
 * not. */
const levels: (number | null)[] = new Array(8).fill(null);
let lastKey = '';
/* Module-level beside `lastKey` and `levels`, for the same reason they are:
 * this is a comparison against the LAST answer, and one drawn page is what the
 * whole module is about. */
let lastPeek = false;

/* SP-48. One instance for the one drawn page's lifetime, same reasoning as
 * `levels`/`lastKey` above: it self-resets on `animating()` going false, so a
 * page swap needs no explicit reset — the new page's first `animating()` call
 * starts its own grace window cold. */
const animCap = createRepaintCap();

/** The drawn page's normalised values, as last read by `pollDrawnPage`. */
export function drawnKnobLevels(): readonly (number | null)[] { return levels; }

/**
 * Advance the delegated page and answer whether the picture moved.
 *
 * The page IDENTITY is part of the comparison, not just the values: jogging to
 * a page whose cells happen to hold the same numbers still changes every label
 * on screen, and a values-only check would leave the old page drawn.
 */
export function pollDrawnPage(owner: PageOwner, nowFn: () => number = Date.now): boolean {
    /* BEFORE the ready check, so an unready page keeps asking: the page is
     * built while the module is still loading, and without this its first
     * empty answer stood for the whole session. */
    /* SPLIT INTO TWO PHASES because they are two different programs: `poll` is
     * Schwung's controller tick (its read cursor, its replan, its settle) and
     * `knoblevels` is movy reading the eight drawn cells back out. On minijv
     * the pair measured 67 ms of a 70 ms tick on device and the probe could not
     * say which half. */
    perfPhase('ctlpoll');
    owner.poll();
    perfPhaseEnd();

    const page = owner.page;
    if (!page) {
        if (lastKey === '') return false;
        lastKey = '';
        levels.fill(null);
        lastPeek = false;
        return true;
    }

    const key = (owner.ref ? owner.ref.track + ':' + owner.ref.componentKey : '?')
              + ':' + page.pageIndex;
    let moved = key !== lastKey;
    lastKey = key;

    perfPhase('knoblevels');
    const next = page.knobLevels();
    perfPhaseEnd();
    for (let k = 0; k < 8; k++) {
        if (levels[k] !== next[k]) { levels[k] = next[k]; moved = true; }
    }
    /* SP-38. ONLY WHEN NOTHING ELSE MOVED, so this is one extra predicate per
     * idle tick and none at all on a tick a value changed — and the predicate
     * is `anim_state`'s own. That map is NOT empty on a still page:
     * `anim_state` only ever sets, never deletes, so it holds one entry per
     * animated key the page has ever drawn, every one of them already past its
     * window. Asking costs a subtraction and a compare per entry — cheap, which
     * is why the idle measurement is unchanged, but not free, and not because
     * there is nothing to walk. See `renderer/schwung-page-anim.ts`.
     *
     * THE CLOCK IS `Date.now()` BECAUSE THE CONTROLLER'S IS. `page_controller`
     * takes `io.now || (() => Date.now())` and movy injects no `io.now`, so both
     * sides of the comparison are stamped from the same source; if movy ever
     * supplies one, this line has to be re-pointed at it or the transition
     * never appears to end.
     *
     * SP-48. `animating()` answers true forever for a modulated/`live`/
     * automated key (see `repaint-cap.ts`'s header) — a real transition is
     * never held back (`animCap` is unthrottled for `ANIM_GRACE_MS`, which
     * outlasts every real one), but a page stuck past that window degrades to
     * one repaint per `REPAINT_CAP_MS` instead of asking every tick forever. */
    /* SP-57. THE ENUM PEEK IS A REAL CHANGE, and it is invisible to everything
     * above: the overlay goes up on a turn that need not move any level (at a
     * clamped end it cannot move one at all) and comes down on a 1500 ms clock
     * with nothing moving whatsoever.
     *
     * BEFORE the animation predicate, deliberately. `animCap` throttles a page
     * that never settles down to one repaint per REPAINT_CAP_MS, which is right
     * for a value that will not rest and wrong for an overlay appearing or
     * disappearing — a peek held back by the cap would be drawn late or left on
     * screen after it expired. */
    const peek = typeof page.peekOpen === 'function' ? page.peekOpen() : false;
    if (peek !== lastPeek) { lastPeek = peek; moved = true; }

    if (!moved) { const now = nowFn(); moved = animCap(page.animating(now), now); }
    return moved;
}
