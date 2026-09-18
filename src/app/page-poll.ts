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

import { appState, VIEW_KNOBS, VIEW_CHAIN } from './state.js';
import { seqState } from '../seq/state.js';
import { sessionReady } from '../seq/set-session.js';
import { schwungEditorActive } from '../renderer/schwung-editor.js';
import type { PageOwner } from './page-owner.js';
import { perfPhase, perfPhaseEnd } from './perf-probe.js';

/**
 * Is the module grid what the eight knobs are addressing?
 *
 * Mirrors the two branches of `app/tick.ts`'s view ladder that draw a module's
 * parameters, and the modal cases that sit in FRONT of them there: the loading
 * splash, session mode's master chain, and Schwung's own dive editor. Every
 * other branch is a different `currentView` and so is excluded by the test
 * itself.
 */
export function moduleGridOnScreen(): boolean {
    return sessionReady()
        && !seqState.sessionMode
        && !schwungEditorActive()
        && (appState.currentView === VIEW_KNOBS || appState.currentView === VIEW_CHAIN);
}

/* The drawn cells as of this tick. Module-level because it is read again at
 * render time — the LED row is lit from the same eight numbers that decided the
 * frame was worth drawing, so the ring can never show a page the screen does
 * not. */
const levels: (number | null)[] = new Array(8).fill(null);
let lastKey = '';

/** The drawn page's normalised values, as last read by `pollDrawnPage`. */
export function drawnKnobLevels(): readonly (number | null)[] { return levels; }

/**
 * Advance the delegated page and answer whether the picture moved.
 *
 * The page IDENTITY is part of the comparison, not just the values: jogging to
 * a page whose cells happen to hold the same numbers still changes every label
 * on screen, and a values-only check would leave the old page drawn.
 */
export function pollDrawnPage(owner: PageOwner): boolean {
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
    return moved;
}
