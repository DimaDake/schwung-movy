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
export function loadingStage(phase: string, chainPending: number): string {
    if (phase === 'booting') return 'STARTING ENGINE';
    if (phase !== 'settling') return 'LOADING SET';
    /* The tail of the wait is the Set-commit press borrowing the surface, which
     * is not a load and must not claim to be one. */
    return chainPending > 0 ? 'LOADING MODULES' : 'PREPARING SET';
}

export function renderLoadingView(phase: string, error: string, chainPending = 0): void {
    clear_screen();
    if (phase === 'failed') {
        centre(18, 'CANNOT LOAD THIS SET', 1);
        centre(30, error, 1);
        /* Naming the button rather than "press to continue": this wipes the
         * Set's sequencer state, and a user who did not mean to should be able
         * to tell from the screen alone. */
        centre(46, 'JOG CLICK = START EMPTY', 1);
        return;
    }
    centre(Math.floor(H / 2) - 3, loadingStage(phase, chainPending), 1);
}
