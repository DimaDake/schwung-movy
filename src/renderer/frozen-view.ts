/* A frozen track's chain view (seq/frozen-view-vm.ts). Its chain is unloaded
 * behind recorded loops, so there is no module page to draw: the waveform of
 * the clip it plays instead, only the playable part, with a playhead. No
 * instruction text: a knob touch or a jog press shows the way out (the big
 * freeze toast). The slot bar stays, so the jog still reaches the MIX slot.
 *
 * Pure, like every renderer: same inputs, same pixels. */

import type { FrozenViewVM } from '../seq/frozen-view-vm.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawBankBar, drawHeader } from './header.js';
import { W } from './layout.js';

const MID = 37;        // the waveform's centre line
const HALF = 22;       // its half height: rows 15..59

export function renderFrozenView(vm: FrozenViewVM): void {
    clear_screen();
    drawHeader(vm.label + ' FROZEN', vm.name ? vm.name.toUpperCase() : null, true);
    drawBankBar(vm.slot, vm.slotCount);
    if (vm.empty || vm.cols.length === 0) {
        const t = vm.empty ? 'EMPTY CLIP' : '...';
        fontPrint(Math.floor((W - fontWidth(t)) / 2), MID - 2, t, 1);
        return;
    }
    for (let x = 0; x < vm.cols.length; x++) {
        const h = Math.max(1, Math.round((vm.cols[x] / 255) * HALF));
        fill_rect(x, MID - h, 1, 2 * h, 1);
    }
    if (vm.playX >= 0) {
        // The playhead: a column cut out of the wave, readable over any level.
        fill_rect(vm.playX, MID - HALF, 1, 2 * HALF, 0);
        fill_rect(vm.playX, MID - HALF, 1, 1, 1);
        fill_rect(vm.playX, MID + HALF - 1, 1, 1, 1);
    }
}
