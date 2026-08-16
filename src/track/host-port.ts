/* A track backed by a schwung shadow slot: index === slot number.
 *
 * Every method here is exactly what its call sites did inline before this
 * existed. The value is not in the code, it is in there being one place that
 * knows a host track is a slot. */

import type { TrackPort } from './port.js';
import { trackRef, type TrackRef } from './ref.js';

export class HostSlotPort implements TrackPort {
    readonly track: TrackRef;
    /* A slot read is served from schwung's own param cache and measured at
     * ~0.3 ms per tick for the whole UI. Nothing to batch, and the shim's bulk
     * channel could not carry it anyway: shim_handle_param_bulk routes only to
     * the overtake DSP, never to a chain slot. */
    readonly bulkReads = false;

    constructor(index: number) {
        this.track = trackRef(index);
    }

    getParam(key: string): string | null {
        if (typeof shadow_get_param !== 'function') return null;
        return shadow_get_param(this.track.index, key);
    }

    setParam(key: string, value: string): boolean {
        if (typeof shadow_set_param !== 'function') return false;
        return shadow_set_param(this.track.index, key, value);
    }

    setParamTimeout(key: string, value: string, timeoutMs: number): boolean {
        if (typeof shadow_set_param_timeout !== 'function') return this.setParam(key, value);
        return shadow_set_param_timeout(this.track.index, key, value, timeoutMs);
    }

    getMany(keys: string[]): (string | null)[] {
        const out: (string | null)[] = [];
        for (const k of keys) out.push(this.getParam(k));
        return out;
    }

    setMany(pairs: [string, string][]): boolean {
        let ok = true;
        for (const [k, v] of pairs) if (!this.setParam(k, v)) ok = false;
        return ok;
    }

    sendMidi(statusType: number, d1: number, d2: number): void {
        if (typeof shadow_send_midi_to_dsp !== 'function') return;
        shadow_send_midi_to_dsp([statusType | this.track.index, d1, d2]);
    }
}
