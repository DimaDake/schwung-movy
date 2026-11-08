/* Whether anything freeze draws has changed since the last tick — the track
 * menu, the big toast, a frozen track's waveform or playhead — so tick.ts
 * repaints only then (the playhead moves a column at a time, ≤128 per loop). */

import { isFrozen } from './freeze.js';
import { freezeToastTrack } from './freeze-toast.js';
import { trackMenuSig } from './track-menu.js';
import { frozenViewSig } from './frozen-view-vm.js';

export function freezeScreenSig(activeTrack: number, nowMs: number): string {
    return trackMenuSig() + '|' + freezeToastTrack(nowMs) + '|'
        + (isFrozen(activeTrack) ? frozenViewSig(activeTrack) : '');
}
