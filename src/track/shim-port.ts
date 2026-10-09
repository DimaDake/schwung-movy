/* A schwung shadow slot, addressed by slot number.
 *
 * No longer a TRACK port — every track is a movy chain now. Two things still
 * reach a shadow slot: `master_fx:` params, which are global to the shim and
 * merely ride slot 0 as a carrier, and the one-time migration, which reads what
 * a slot still holds (`slot-read.ts`). */

import type { TrackPort } from './port.js';
import { trackRef, type TrackRef } from './ref.js';
import { platform } from '../platform/index.js';

export class ShimSlotPort implements TrackPort {
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
        return platform.slotGet(this.track.index, key);
    }

    setParam(key: string, value: string): boolean {
        return platform.slotSet(this.track.index, key, value);
    }

    setParamTimeout(key: string, value: string, timeoutMs: number): boolean {
        return platform.slotSetTimeout(this.track.index, key, value, timeoutMs)
            ?? this.setParam(key, value);
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
        platform.slotSendMidi([statusType | this.track.index, d1, d2]);
    }
}
