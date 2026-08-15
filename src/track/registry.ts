/* Index -> port, cached.
 *
 * Ports are looked up on every param read, and reads happen per tick — building
 * one per call would allocate in the hot path. */

import { HostSlotPort } from './host-port.js';
import { UnbackedPort } from './unbacked-port.js';
import type { TrackPort } from './port.js';
import { trackKind } from './ref.js';

const ports: (TrackPort | undefined)[] = [];

export function portFor(index: number): TrackPort {
    let p = ports[index];
    if (!p) {
        /* Movy tracks answer "nothing loaded" until Stage 3 gives them real
         * chains. Stage 3 swaps UnbackedPort for MovyChainPort here and nothing
         * else in the UI has to know it happened. */
        p = trackKind(index) === 'host' ? new HostSlotPort(index) : new UnbackedPort(index);
        ports[index] = p;
    }
    return p;
}

/** Drop cached ports. Tests use this to swap the ambient shadow_* globals. */
export function resetPorts(): void {
    ports.length = 0;
}
