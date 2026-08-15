/* How you talk to a track, whichever kind it is.
 *
 * Every consumer in src/ goes through this interface, so adding movy-hosted
 * tracks later means adding one implementation rather than revisiting ~62 call
 * sites. The method set is deliberately narrow: it is what the UI actually
 * needs, not a mirror of the schwung API. */

import type { TrackRef } from './ref.js';

export interface TrackPort {
    readonly track: TrackRef;

    getParam(key: string): string | null;
    setParam(key: string, value: string): boolean;
    setParamTimeout(key: string, value: string, timeoutMs: number): boolean;

    /** Read several keys at once. Results are positional: one entry per key, in
     *  the order asked. A host track loops; a movy chain collapses these into a
     *  single bulk round trip, which is why the batch shape exists at all. */
    getMany(keys: string[]): (string | null)[];
    setMany(pairs: [string, string][]): boolean;

    /** `statusType` is the type nibble alone (0x90, 0x80, 0xB0). The port adds
     *  the channel — a host track is addressed BY its channel, so leaving that
     *  to callers is how notes end up on the wrong track. */
    sendMidi(statusType: number, d1: number, d2: number): void;
}
