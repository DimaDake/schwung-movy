/* mix-apply.ts — the ABSOLUTE-VALUE half of the MIX page (SP-55), mirroring
 * `main-page-apply.ts`'s split: movy's own delta gesture (`mix-model.ts`'s
 * `edit()`) and the virtual-component seam's per-cell `set()`
 * (`mix-schwung-cells.ts` — Schwung computes an absolute value, never a
 * delta) both write through `writeMix`, and only this file opens the undo
 * group for the delegated path — the SAME key `mix-model.ts`'s
 * `handleKnobRelease` already closes on release, so the two paths cannot
 * leave a group open or double-close one.
 *
 * NOT unified with `edit()` itself: that function walks the non-linear dB
 * ladder (`stepAmpDb`) at a per-DETENT rate, re-using its own cached `MixVals`
 * across a whole turn; re-reading the port on every detent to share this
 * function would add an IPC round trip per detent to the `off`-mode path for
 * no behavioural gain, since both already bottom out in `writeMix`. */

import { beginGesture } from '../undo/edit.js';
import {
    mixGestureKey, packMixValue, readMix, writeMix, type MixFieldName,
} from './mix-io.js';

/** `frac` is the field's own POSITION (0..1, `fieldFrac`'s units) — what
 *  Schwung's own knob math computed as an absolute value over the cell's
 *  declared 0..1 range. Read-modify-write: the engine's `mix` param is one
 *  string carrying every field, so a write of one field must carry the rest
 *  forward unchanged. */
export function applyMixFieldAbs(track: number, field: MixFieldName, absValue: number): void {
    const v = readMix(track);
    const before = packMixValue(v);
    if (field === 'pan') v.pan = absValue;
    else if (field === 'gain') v.gain = absValue;
    else v.send[Number(field.slice(4)) - 1] = absValue;
    if (packMixValue(v) === before) return;
    beginGesture(mixGestureKey(track, field), 'MIX', 'T' + (track + 1), false);
    writeMix(track, v, before);
}
