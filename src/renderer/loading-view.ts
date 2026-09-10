/* The screen while movy is not yet live, and the one when it cannot become
 * live.
 *
 * Deliberately plain: the loading case lasts a couple of seconds and anything
 * animated here competes for tick budget with the engine boot it is waiting on.
 * The failure case is plain for a different reason — it has to be read and
 * acted on, so it says what broke and what the one button does. */

import { fontPrint, fontWidth } from '../font/index.js';
import { W } from './layout.js';

const H = 64;

function centre(y: number, text: string, color: number): void {
    fontPrint(Math.floor((W - fontWidth(text)) / 2), y, text, color);
}

/** What the splash is waiting on. Separated from the drawing so the wording is
 *  testable without pixels — and because "loaded" and "playable" are different
 *  things the user is entitled to see the difference between: the Set's state
 *  lands in one blocking write, but its modules arrive one per audio callback
 *  after it. */
export function loadingStage(
    phase: string, chainPending: number, migrating = false,
): string {
    if (phase === 'booting') return 'STARTING ENGINE';
    if (phase !== 'settling') return 'LOADING SET';
    /* Ahead of the module count, because the one-time move off schwung's slots
     * is not a load and the count says nothing about it: the chains it is about
     * to re-state have not been asked for yet, so this would otherwise read
     * "PREPARING SET" through the whole of it. It is also the only wait a user
     * meets once per old set and never again, which is worth naming. */
    if (migrating) return 'MIGRATING TRACKS';
    /* The tail of the wait is the Set-commit press borrowing the surface, which
     * is not a load and must not claim to be one. */
    return chainPending > 0 ? 'LOADING MODULES' : 'PREPARING SET';
}

/** The failure screen's three lines: what happened, why, and what to do.
 *
 *  Separated from the drawing for the same reason as `loadingStage` — and
 *  because WHICH ACTION IS OFFERED is a correctness question, not a wording
 *  one. The only recovery movy has is to blank the set, and that answers
 *  exactly one failure: this set's own file will not parse. Offered against an
 *  engine that never started it is worse than useless — the set is fine, the
 *  engine is not, and a jog click the user reads as "get me out of here"
 *  overwrites their sequencer state with nothing.
 *
 *  An empty string means the line is not drawn.
 */
export function failureLines(reason: string, scope: string): [string, string, string] {
    if (scope === 'engine') {
        /* No "cannot load this set": the set is not what failed, and a user who
         * is told it is will go looking for the damage in the wrong place. */
        return [reason, 'RESTART YOUR MOVE', ''];
    }
    /* Naming the button rather than "press to continue": this wipes the Set's
     * sequencer state, and a user who did not mean to should be able to tell
     * from the screen alone. */
    return ['CANNOT LOAD THIS SET', reason, 'JOG CLICK = START EMPTY'];
}

export function renderLoadingView(
    phase: string, error: string, chainPending = 0, failScope = 'set',
    migrating = false,
): void {
    clear_screen();
    if (phase === 'failed') {
        const lines = failureLines(error, failScope);
        /* Two lines sit where three would leave a gap at the bottom, so the
         * block stays vertically centred whichever failure this is. */
        const ys = lines[2] === '' ? [22, 36, 0] : [18, 30, 46];
        for (let i = 0; i < 3; i++) if (lines[i] !== '') centre(ys[i], lines[i], 1);
        return;
    }
    centre(Math.floor(H / 2) - 3, loadingStage(phase, chainPending, migrating), 1);
}
