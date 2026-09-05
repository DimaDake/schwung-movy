/* Params addressed at movy's engine ROOT, with the component key carrying the
 * namespace — today the two send buses, `snd0` and `snd1`.
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
 * Batching matters here for the same reason it does on a chain: a single engine
 * param GET blocks ~3-5 ms on device and the model refreshes eight knob values
 * at a time, so a send's param page must cost ONE bulk round trip. */

import type { TrackPort } from './port.js';
import { trackRef, type TrackRef } from './ref.js';
import { decodeBulk, encodeBulk } from './bulk.js';

/* Routing marker for the bulk channel: the shim dispatches on this prefix and
 * hands the payload to whichever DSP is loaded as overtake — movy's engine. */
const BULK_MARKER = 'overtake_dsp:';

export class EngineRootPort implements TrackPort {
    /* Required by the shape, and reported as track 0. Nothing here is addressed
     * by track; the field is a claim this port does not make. */
    readonly track: TrackRef;
    readonly bulkReads = true;

    constructor() {
        this.track = trackRef(0);
    }

    /** Verbatim: the caller's component key already names the destination. */
    private key(k: string): string {
        return k;
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

    /* A send bus has no synth and no notes: nothing plays it, tracks feed it
     * audio. Silently ignored rather than left undefined, because the shape
     * requires it and a throw here would break a generic caller. */
    sendMidi(_statusType: number, _d1: number, _d2: number): void {}
}
