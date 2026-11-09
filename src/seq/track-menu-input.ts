/* The track menu's input (seq/track-menu.ts), first look in the router while
 * it is open: Back closes, a jog click acts, every other press is swallowed
 * (releases pass, so nothing held at the open sticks). */

import { appState, VIEW_CHAIN } from '../app/state.js';
import { selectTrack } from '../track/focus.js';
import { closeTrackMenu, trackMenuActive, trackMenuClick, trackMenuTrack } from './track-menu.js';

/** `true` = consumed. */
export function trackMenuMidi(data: number[]): boolean {
    if (!trackMenuActive()) return false;
    const type = data[0] & 0xF0, d1 = data[1], d2 = data[2];
    const press = (type === 0x90 || type === 0xB0) && d2 > 0;
    if (type === 0xB0 && d1 === MoveBack && d2 > 0) { closeTrackMenu(); return true; }
    if (type === 0xB0 && d1 === MoveMainButton && d2 > 0) {
        const t = trackMenuTrack();
        trackMenuClick(appState.trackModels[t]?.[1]?.getModuleName() ?? '');
        /* Freeze or unfreeze, the click lands on its track: a freeze shows its
         * waveform growing while it records, an unfreeze its synth coming
         * back. An armed click (menu still open) has done nothing yet. */
        if (!trackMenuActive()) {
            selectTrack(t);
            appState.currentView = VIEW_CHAIN;
        }
        return true;
    }
    if (type === 0xB0 && d1 === MoveMainKnob) return true;   // one row: nothing to move
    /* Knob touches (notes 0-9) and turns are presses too. */
    return press || type === 0xA0 || type === 0xE0;
}
