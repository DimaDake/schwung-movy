/* ext-knobs.ts — dispatch for an external knob controller on USB-A. What each
 * CC means is midi/ext-knob-map.ts; this replays it and keeps a Twister's
 * rings honest.
 */

import { appState } from '../app/state.js';
import { platform } from '../platform/index.js';
import { pageOwnerOf } from '../app/page-owner.js';
import { onMidiMessageInternal, knobModel } from './router.js';
import { createExtKnobState, extKnobActions, TW_ASSIGNED } from './ext-knob-map.js';

const state = createExtKnobState();

/* A Twister forgets its ring colours on reconnect, and nothing tells us it
 * reconnected — so the rings are repainted whenever CCs resume after a quiet
 * spell. Cheap: 32 messages, at most once per gap. */
const WAKE_GAP_MS = 10000;
let lastCcMs = 0;

/* Channel 2 CC n sets encoder n's colour (hue 1-126); channel 3 CC n its
 * animation byte, where 17..47 is RGB brightness (off..full) and 65..95 the
 * indicator's. Assigned encoders are green, the rest dark, so the controller
 * shows which encoders do something. */
const TW_GREEN = 50;

function paintTwister(): void {
    const assigned = new Set(TW_ASSIGNED);
    for (let enc = 0; enc < 16; enc++) {
        if (assigned.has(enc)) {
            platform.externalSend([0x0B, 0xB1, enc, TW_GREEN]);
            platform.externalSend([0x0B, 0xB2, enc, 47]);
            platform.externalSend([0x0B, 0xB2, enc, 95]);
        } else {
            platform.externalSend([0x0B, 0xB2, enc, 17]);
            platform.externalSend([0x0B, 0xB2, enc, 65]);
        }
    }
}

/* Step the preset list of the module the knobs edit, from whatever page is on
 * screen — the page layer lands on the preset door, steps, and comes back. */
function presetTurn(delta: number): void {
    const page = pageOwnerOf(knobModel()).page;
    if (page && page.presetStep(delta)) appState.dirty = true;
}

export function onExternalControlChange(data: number[]): void {
    const now = Date.now();
    if (now - lastCcMs > WAKE_GAP_MS) paintTwister();
    lastCcMs = now;
    const ch = (data[0] & 0x0F) + 1;
    for (const a of extKnobActions(state, ch, data[1] & 0x7F, data[2] & 0x7F)) {
        if (a.kind === 'cc') onMidiMessageInternal([0xB0, a.cc, a.value]);
        else presetTurn(a.delta);
    }
}
