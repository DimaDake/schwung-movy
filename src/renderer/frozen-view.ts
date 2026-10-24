/* A frozen track's chain view (seq/freeze.ts). Its chain is unloaded behind a
 * recorded loop, so there is no module page to draw — and the empty-slot
 * screen ("CLICK JOG: ADD MODULE") would invite exactly the edit a frozen
 * track refuses. This says what the track is instead: frozen, which synth it
 * was, and how to bring it back.
 *
 * Pure, like every renderer: same inputs, same pixels. */

import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader } from './header.js';
import { W } from './layout.js';

function centered(y: number, text: string): void {
    let t = text;
    while (t.length > 1 && fontWidth(t) > W - 4) t = t.slice(0, -1);
    fontPrint(Math.max(0, Math.floor((W - fontWidth(t)) / 2)), y, t, 1);
}

export function renderFrozenView(trackLabel: string, moduleName: string): void {
    clear_screen();
    drawHeader(trackLabel, 'FROZEN', true);
    centered(20, moduleName ? moduleName.toUpperCase() : 'FROZEN TRACK');
    centered(30, 'PLAYING ITS FROZEN LOOP');
    centered(46, 'SHIFT + DOUBLE TAP TRACK');
    centered(54, 'TO UNFREEZE');
}
