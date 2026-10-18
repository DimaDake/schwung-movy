/* mixer-input.ts — what the knobs and the jog do while the Session mixer is up.
 *
 * Schwung's page does the work (touch → held toast, turn → the cell's own
 * absolute write, jog → the next custom page); this file only routes to it and
 * closes the undo gesture the write opened, which is the MIX page's own key
 * (`applyMixFieldAbs`), so a mixer turn and a MIX turn undo the same way. */

import { appState } from '../app/state.js';
import { pageOwnerForComponent } from '../app/page-owner-virtual.js';
import { MIXER_COMPONENT } from '../chain/config.js';
import { endEdit } from '../undo/group.js';
import { mixGestureKey } from '../mixer/mix-io.js';
import { trackOfMixerKey, MIXER_KNOBS } from '../mixer/mixer-contract.js';

const owner = () => pageOwnerForComponent(MIXER_COMPONENT);

export function mixerKnobTouch(k: number, down: boolean): void {
    if (k >= MIXER_KNOBS) return;
    const page = owner().page;
    if (!page) return;
    /* Asked BEFORE the release reaches the page: the slot's key is the track
     * whose gesture is closing, and it cannot change under a held knob. */
    const track = trackOfMixerKey(page.keyAt(k) ?? undefined);
    page.knobTouch(k, down);
    if (!down && track >= 0) endEdit(mixGestureKey(track, 'gain'));
    appState.dirty = true;
}

export function mixerKnobTurn(k: number, delta: number): void {
    if (k >= MIXER_KNOBS) return;
    owner().page?.knobTurn(k, delta);
    appState.dirty = true;
}

export function mixerJog(delta: number): void {
    const o = owner();
    o.changePage(delta > 0 ? 1 : -1);
    appState.dirty = true;
}
