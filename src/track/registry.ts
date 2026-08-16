/* Index -> port, cached.
 *
 * Ports are looked up on every param read, and reads happen per tick — building
 * one per call would allocate in the hot path. */

import { HostSlotPort } from './host-port.js';
import { MovyChainPort } from './movy-chain-port.js';
import type { TrackPort } from './port.js';
import { trackKind } from './ref.js';

const ports: (TrackPort | undefined)[] = [];

export function portFor(index: number): TrackPort {
    let p = ports[index];
    if (!p) {
        /* The one place that knows the two kinds apart. A host track is a
         * schwung shadow slot; a movy track is a chain inside movy's own engine,
         * addressed through the `ch<N>:` param namespace. Nothing else in the UI
         * has to know which it is holding. */
        p = trackKind(index) === 'host' ? new HostSlotPort(index) : new MovyChainPort(index);
        ports[index] = p;
    }
    return p;
}

/** Drop cached ports. Tests use this to swap the ambient shadow_* globals. */
export function resetPorts(): void {
    ports.length = 0;
}
