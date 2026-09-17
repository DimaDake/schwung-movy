/* How you talk to a track, whichever kind it is.
 *
 * Every consumer in src/ goes through this interface, so adding movy-hosted
 * tracks later means adding one implementation rather than revisiting ~62 call
 * sites. The method set is deliberately narrow: it is what the UI actually
 * needs, not a mirror of the schwung API. */

import type { TrackRef } from './ref.js';

export interface TrackPort {
    readonly track: TrackRef;

    /** True when a single read costs a full round trip and batching is the only
     *  way to keep the tick affordable. Callers that can choose a batch shape
     *  read this rather than asking which KIND of track they are holding. */
    readonly bulkReads: boolean;

    getParam(key: string): string | null;
    setParam(key: string, value: string): boolean;
    setParamTimeout(key: string, value: string, timeoutMs: number): boolean;

    /** Read several keys at once. Results are positional: one entry per key, in
     *  the order asked. A host track loops; a movy chain collapses these into a
     *  single bulk round trip, which is why the batch shape exists at all. */
    getMany(keys: string[]): (string | null)[];
    setMany(pairs: [string, string][]): boolean;

    /** How many writes this port has made, and which keys the last of them
     *  carried. A reader that CACHES a value has to know when movy itself made
     *  that value stale — and on a delegated page movy is the writer (the knob
     *  under the hand, the sequencer, automation, undo), all of them through the
     *  one memoized port for the track. Pull rather than push, so a cache that
     *  is thrown away (a mode change drops every SchwungPage) leaves no listener
     *  behind. `writesSince` answers null when more writes happened than the log
     *  holds: the caller cannot know what went stale, so it must drop everything.
     *
     *  Optional because only a port whose reads are worth caching needs it — a
     *  shadow slot read is served from schwung's own cache at ~0.3 ms and is
     *  never batched or cached by movy. */
    writeSeq?(): number;
    writesSince?(seq: number): string[] | null;

    /** `statusType` is the type nibble alone (0x90, 0x80, 0xB0). The port adds
     *  the channel — a host track is addressed BY its channel, so leaving that
     *  to callers is how notes end up on the wrong track. */
    sendMidi(statusType: number, d1: number, d2: number): void;
}
