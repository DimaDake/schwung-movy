/* A track whose chain movy hosts itself, inside its own engine.
 *
 * Where a host track's params live in schwung's per-slot shared memory, a movy
 * track's live in movy-dsp — so every read and write is an engine param under
 * the `ch<N>:` namespace, which the engine routes to chain instance N.
 *
 * The param channel itself — blocking writes, the bulk round trip that makes a
 * page of knobs affordable, and the counters that make a refused write visible
 * — is `EnginePort` over `host/param.ts`. All that is left here is the
 * namespace and what a chain does with MIDI. */

import { EnginePort } from './engine-port.js';
import { chainInstance, trackRef, type TrackRef } from './ref.js';

export class MovyChainPort extends EnginePort {
    readonly track: TrackRef;
    private readonly chain: number;

    constructor(index: number) {
        super();
        this.track = trackRef(index);
        this.chain = chainInstance(index);
    }

    /** `synth:cutoff` on track 7 becomes `ch3:synth:cutoff` in the engine. */
    protected key(k: string): string {
        return 'ch' + this.chain + ':' + k;
    }

    /* Live notes reach the chain through the engine rather than
     * `shadow_send_midi_to_dsp`, which addresses schwung's slots and knows
     * nothing about movy's chains. The channel nibble is dropped: a chain
     * instance has one synth and does not filter by channel (the shim does that
     * for its own slots), so the chain number in the key is the routing. */
    sendMidi(statusType: number, d1: number, d2: number): void {
        this.setParam('midi', statusType + '.' + d1 + '.' + d2);
    }
}
