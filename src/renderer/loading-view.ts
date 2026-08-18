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

export function renderLoadingView(phase: string, error: string): void {
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
    centre(Math.floor(H / 2) - 3, phase === 'booting' ? 'STARTING ENGINE' : 'LOADING SET', 1);
}
