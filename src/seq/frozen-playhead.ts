/* The frozen / freezing screen's playhead, painted per tick like the note
 * view's (seq/note-view.ts): a whole repaint only when the view under it was
 * redrawn; otherwise just the old column back and the new one inverted. */

import { paintPlayheadColumn } from '../renderer/playhead-column.js';
import { WAVE_BOT, WAVE_TOP, waveSpans, type FrozenViewVM } from './frozen-view-vm.js';

let shownX = -1;

export function frozenPlayheadTick(vm: FrozenViewVM, repainted: boolean, x: number): void {
    if (repainted) shownX = -1;
    if (x === shownX) return;
    if (shownX >= 0) paintPlayheadColumn(shownX, WAVE_TOP, WAVE_BOT, waveSpans(vm, shownX), false);
    if (x >= 0) paintPlayheadColumn(x, WAVE_TOP, WAVE_BOT, waveSpans(vm, x), true);
    shownX = x;
}

export function resetFrozenPlayhead(): void {
    shownX = -1;
}
