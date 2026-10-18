/* A USB-A keyboard (cable 2). The ENGINE sounds it (ext_route.rs), at pad
 * latency; this side only RECORDS, through the pad path, so a key behaves like a
 * pad under Rec, step record and a held step. Wheels are played by the engine
 * and deliberately not recorded. */

import { appState } from '../app/state.js';
import { drumConfigFor } from '../track/pad-route.js';
import { extDrumPitch } from '../track/ext-route.js';
import { seqNotePadPlayed, seqNotePadReleased } from '../seq/router-pads.js';
import { EXT_KEY_BASE, extHold, extRelease } from './external-ledger.js';

export function onMidiMessageExternal(data: number[]): void {
    if (!data || data.length < 3) return;
    const type = data[0] & 0xF0, note = data[1] & 0x7F, vel = data[2];
    const key = EXT_KEY_BASE + note;
    if (type === 0x90 && vel > 0) {
        const track = appState.activeTrack.index;
        const drum = drumConfigFor(track);
        const pitch = drum ? extDrumPitch(note, drum) : note;
        if (pitch < 0) return;
        /* A retrigger before the off: close the first capture so it is not orphaned. */
        const prev = extRelease(key);
        if (prev !== undefined) seqNotePadReleased(key, prev);
        extHold(key, track);
        seqNotePadPlayed(track, key, pitch, vel);
    } else if (type === 0x80 || type === 0x90) {
        const track = extRelease(key);
        if (track !== undefined) seqNotePadReleased(key, track);
    }
}
