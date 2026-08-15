/* A movy track with nothing hosting it yet.
 *
 * Stage 2 gives movy tracks clips, notes and mutes but no chain — that arrives
 * in Stage 3. Every param read therefore has to answer "nothing loaded" rather
 * than throw, because the chain and knob pages run for whichever track is
 * selected and must not care which stage we are in. */

import type { TrackPort } from './port.js';
import { trackRef, type TrackRef } from './ref.js';

export class UnbackedPort implements TrackPort {
    readonly track: TrackRef;

    constructor(index: number) {
        this.track = trackRef(index);
    }

    getParam(_key: string): string | null { return null; }
    setParam(_key: string, _value: string): boolean { return false; }
    setParamTimeout(_key: string, _value: string, _timeoutMs: number): boolean { return false; }
    getMany(keys: string[]): (string | null)[] { return keys.map(() => null); }
    setMany(_pairs: [string, string][]): boolean { return false; }

    /* Silently dropped rather than refused: teardown sends a note-off to every
     * track, and a movy track legitimately has nothing to close. */
    sendMidi(_statusType: number, _d1: number, _d2: number): void { /* nothing to sound yet */ }
}
