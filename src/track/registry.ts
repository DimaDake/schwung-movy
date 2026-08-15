/* Index -> port, cached.
 *
 * Ports are looked up on every param read, and reads happen per tick — building
 * one per call would allocate in the hot path. */

import { HostSlotPort } from './host-port.js';
import type { TrackPort } from './port.js';
import { trackKind } from './ref.js';

const ports: (TrackPort | undefined)[] = [];

export function portFor(index: number): TrackPort {
    let p = ports[index];
    if (!p) {
        /* Stage 1 is host-only. Stage 3 adds MovyChainPort here; until then a
         * movy index would silently address a slot that does not exist, so it
         * is refused loudly instead. */
        if (trackKind(index) !== 'host') {
            throw new Error('movy-hosted tracks are not implemented yet: track ' + index);
        }
        p = new HostSlotPort(index);
        ports[index] = p;
    }
    return p;
}

/** Drop cached ports. Tests use this to swap the ambient shadow_* globals. */
export function resetPorts(): void {
    ports.length = 0;
}
