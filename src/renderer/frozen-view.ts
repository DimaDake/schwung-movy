/* A frozen track's chain view, and the screen while one is being frozen
 * (seq/frozen-view-vm.ts). Its chain is unloaded behind recorded loops, so
 * there is no module page to draw: the waveform instead. The playhead is
 * painted over it per tick (seq/frozen-playhead.ts). No instruction text: a
 * knob touch or a jog press shows the way out (the big freeze toast). The slot
 * bar stays, so the jog still reaches the MIX slot.
 *
 * Pure, like every renderer: same inputs, same pixels. */

import type { FrozenViewVM } from '../seq/frozen-view-vm.js';
import { WAVE_BOT, WAVE_TOP, waveSpans } from '../seq/frozen-view-vm.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawBankBar, drawHeader } from './header.js';
import { W } from './layout.js';

export function renderFrozenView(vm: FrozenViewVM): void {
    clear_screen();
    drawHeader(vm.label + (vm.recording ? ' FREEZING' : ' FROZEN'), vm.name ? vm.name.toUpperCase() : null, true);
    drawBankBar(vm.slot, vm.slotCount);
    if (vm.empty) {
        const t = 'EMPTY CLIP';
        fontPrint(Math.floor((W - fontWidth(t)) / 2), ((WAVE_TOP + WAVE_BOT) >> 1) - 2, t, 1);
        return;
    }
    for (let x = 0; x < vm.cols.length; x++) {
        for (const [y, h] of waveSpans(vm, x)) fill_rect(x, y, 1, h, 1);
    }
}
