/* A track whose chain movy hosts itself, inside its own engine.
 *
 * Where a host track's params live in schwung's per-slot shared memory, a movy
 * track's live in movy-dsp — so every read and write is an engine param under
 * the `ch<N>:` namespace, which the engine routes to chain instance N.
 *
 * **Batching is the whole point.** A single engine param GET blocks ~3-5 ms on
 * device, and the model layer refreshes eight knob values at a time; done one by
 * one that is ~40 ms against a tick period that IS movy's MIDI sampling
 * interval. `getMany` therefore issues ONE bulk round trip for the whole page.
 * The host-track port loops instead, because its per-slot gets are cheap. */

import type { TrackPort } from './port.js';
import { chainInstance, trackRef, type TrackRef } from './ref.js';
import { decodeBulk, encodeBulk } from './bulk.js';

/* Routing marker for the bulk channel: the shim dispatches on this prefix and
 * hands the payload to whichever DSP is loaded as overtake — movy's engine. */
const BULK_MARKER = 'overtake_dsp:';

export class MovyChainPort implements TrackPort {
    readonly track: TrackRef;
    readonly bulkReads = true;
    private readonly chain: number;

    constructor(index: number) {
        this.track = trackRef(index);
        this.chain = chainInstance(index);
    }

    /** `synth:cutoff` on track 7 becomes `ch3:synth:cutoff` in the engine. */
    private key(k: string): string {
        return 'ch' + this.chain + ':' + k;
    }

    getParam(key: string): string | null {
        if (typeof host_module_get_param !== 'function') return null;
        return host_module_get_param(this.key(key));
    }

    setParam(key: string, value: string): boolean {
        /* Blocking, like every other engine write: the overtake param SHM is a
         * single slot, so a non-blocking write is routinely clobbered before the
         * shim consumes it. */
        if (typeof host_module_set_param_blocking === 'function') {
            return host_module_set_param_blocking(this.key(key), value, 50);
        }
        if (typeof host_module_set_param === 'function') {
            return host_module_set_param(this.key(key), value);
        }
        return false;
    }

    setParamTimeout(key: string, value: string, timeoutMs: number): boolean {
        if (typeof host_module_set_param_blocking === 'function') {
            return host_module_set_param_blocking(this.key(key), value, timeoutMs);
        }
        return this.setParam(key, value);
    }

    getMany(keys: string[]): (string | null)[] {
        if (keys.length === 0) return [];
        if (typeof shadow_get_params !== 'function') {
            return keys.map((k) => this.getParam(k));
        }
        const payload = encodeBulk(keys.map((k) => this.key(k)));
        const items = decodeBulk(shadow_get_params(0, BULK_MARKER, payload));
        /* A malformed or short response must not read as "every param is
         * empty" — that would paint a whole page of zeroed knobs over the real
         * values. Fall back to individual reads instead. */
        if (!items || items.length !== keys.length) {
            return keys.map((k) => this.getParam(k));
        }
        return items.map((v) => (v === '' ? null : v));
    }

    setMany(pairs: [string, string][]): boolean {
        if (pairs.length === 0) return true;
        if (typeof shadow_set_params !== 'function') {
            let ok = true;
            for (const [k, v] of pairs) if (!this.setParam(k, v)) ok = false;
            return ok;
        }
        const flat: string[] = [];
        for (const [k, v] of pairs) { flat.push(this.key(k)); flat.push(v); }
        return shadow_set_params(0, BULK_MARKER, encodeBulk(flat)) === true;
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
