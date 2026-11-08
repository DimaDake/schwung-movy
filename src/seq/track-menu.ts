/* The track menu: Shift + a track button. A list drawn like Settings
 * (flags-view.ts) with, for now, one row: FREEZE T3, or UNFREEZE T3 on a
 * frozen track. Jog click acts, Back closes. It opens for the pressed track
 * WITHOUT switching to it (user, 2026-11-08): freeze T5 while working on T2.
 *
 * Unfreeze with the transport running stops it (the synth reload blocks the
 * audio, lib.rs `unfrz`): the first click arms (`CONFIRM?`, the hint saying
 * play stops), the second unfreezes — Settings' click-twice pattern (migrate-action.ts). */

import { seqState } from './state.js';
import { isFrozen, freezeConfirm } from './freeze.js';
import type { FlagsPageVM } from './flags-page-vm.js';

const state = { track: -1, armed: false };

export function trackMenuActive(): boolean {
    return state.track >= 0;
}

export function trackMenuTrack(): number {
    return state.track;
}

export function openTrackMenu(track: number): void {
    state.track = track;
    state.armed = false;
}

export function closeTrackMenu(): void {
    state.track = -1;
    state.armed = false;
}

function stops(): boolean {
    return isFrozen(state.track) && seqState.playing;
}

/** Jog click on the row. `name` is the track's synth, while it is loaded (the
 *  frozen screen names it afterwards). */
export function trackMenuClick(name: string): void {
    const t = state.track;
    if (t < 0) return;
    if (stops() && !state.armed) {
        state.armed = true;
        return;
    }
    freezeConfirm(t, isFrozen(t), name);
    closeTrackMenu();
}

/** Changes whenever the menu would draw differently (freeze-screen.ts). */
export function trackMenuSig(): string {
    return state.track < 0 ? '' : state.track + (state.armed ? 'a' : '') + (isFrozen(state.track) ? 'f' : '')
        + (seqState.playing ? 'p' : '');
}

export function buildTrackMenuVM(): FlagsPageVM {
    const label = 'T' + (state.track + 1);
    const frozen = isFrozen(state.track);
    /* An arm the transport no longer needs (Stop pressed meanwhile) is gone. */
    if (!stops()) state.armed = false;
    return {
        rows: [{ name: (frozen ? 'UNFREEZE ' : 'FREEZE ') + label,
                 value: state.armed ? 'CONFIRM?' : '>', selected: true }],
        selected: 0,
        hint: state.armed ? 'Click again: play stops, the synth comes back.'
            : frozen ? 'Brings the synth back.' + (stops() ? ' Stops play.' : '')
                     : 'Records every clip. Saves CPU.',
    };
}

export function resetTrackMenu(): void {
    closeTrackMenu();
}
