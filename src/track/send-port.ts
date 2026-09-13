/* Params addressed at movy's engine ROOT, with the component key carrying the
 * namespace — the send buses, `snd0` upward.
 *
 * Deliberately NOT a prefixing port like `MovyChainPort`. A chain port turns
 * `synth:cutoff` into `ch7:synth:cutoff` because the track number is not in the
 * component key; a send's bus IS its component key, so prefixing again would
 * ask the engine for `snd0:snd0:chain_params` and every read would answer
 * nothing — which renders a loaded send as an empty slot.
 *
 * A send is still not a track: routing a master-page slot through `portFor(0)`
 * would send its edits into whatever track 0 is holding.
 *
 * The channel is `EnginePort` over `host/param.ts`, shared with the chain port
 * — including the bulk round trip, which matters here for the same reason: a
 * single engine GET blocks ~3-5 ms on device and the model refreshes eight knob
 * values at a time, so a send's param page must cost ONE round trip. */

import { EnginePort } from './engine-port.js';
import { trackRef, type TrackRef } from './ref.js';

export class EngineRootPort extends EnginePort {
    /* Required by the shape, and reported as track 0. Nothing here is addressed
     * by track; the field is a claim this port does not make. */
    readonly track: TrackRef;

    constructor() {
        super();
        this.track = trackRef(0);
    }

    /** Verbatim: the caller's component key already names the destination. */
    protected key(k: string): string {
        return k;
    }

    /* A send bus has no synth and no notes: nothing plays it, tracks feed it
     * audio. Silently ignored rather than left undefined, because the shape
     * requires it and a throw here would break a generic caller. */
    sendMidi(_statusType: number, _d1: number, _d2: number): void {}
}
