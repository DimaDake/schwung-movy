/* The single door for chain-param writes.
 *
 * Everything a user can change in schwung's chain — synth params, LFO params,
 * enums, file picks, track volume — goes through here so undo sees it. The
 * write itself is exactly what each call site did before; the only addition is
 * recording the inverse.
 *
 * A param write is its own whole inverse: no side effects, and the previous
 * value is already in hand at every call site (movy mirrors it in
 * knobValues). That is why the param domain journals inverses instead of
 * snapshotting, unlike the engine.
 *
 * The write itself now goes through the track's port, so this file no longer
 * names `shadow_set_param` at all — `src/track/host-port.ts` is the one place
 * that does. `browser-test/logic.mjs` fails on any direct shadow
 * param write added outside that file and its short allowlist. */

import { recordParamOp } from '../undo/record.js';
import type { TrackPort } from '../track/port.js';

/**
 * Write a chain param and record its inverse.
 *
 * `oldVal` is what the param held before — pass `null` only for a write with
 * no meaningful previous value (a load-time seed), which is recorded as
 * un-undoable rather than guessed at.
 */
export function setChainParam(port: TrackPort, key: string,
                              value: string, oldVal: string | null): boolean {
    /* Undo records the track INDEX, which for a host track is its slot number —
     * so existing undo history stays readable across this refactor. */
    if (oldVal !== null && oldVal !== value) recordParamOp(port.track.index, key, oldVal, value);
    return port.setParam(key, value);
}

/** A write that is deliberately outside undo: infrastructure rather than a
 *  user edit (lane mappings, load-time seeds, the focused drum pad). Named so
 *  the intent is visible at the call site instead of looking like an omission. */
export function setChainParamUntracked(port: TrackPort, key: string, value: string): boolean {
    return port.setParam(key, value);
}
