/* Index -> port, cached.
 *
 * Ports are looked up on every param read, and reads happen per tick — building
 * one per call would allocate in the hot path. */

import { MovyChainPort } from './movy-chain-port.js';
import { EngineRootPort } from './send-port.js';
import type { TrackPort } from './port.js';
import { isMasterComponent, isSendComponent } from '../chain/config.js';

const ports: (TrackPort | undefined)[] = [];

export function portFor(index: number): TrackPort {
    let p = ports[index];
    if (!p) {
        /* A track is a chain inside movy's own engine, addressed through the
         * `ch<N>:` param namespace. */
        p = new MovyChainPort(index);
        ports[index] = p;
    }
    return p;
}

let enginePort: TrackPort | undefined;

/** Params addressed at movy's engine root — the send buses and the master
 *  chain, whose component key already names the destination. Not a track;
 *  see `EngineRootPort`. */
export function engineRootPort(): TrackPort {
    if (!enginePort) enginePort = new EngineRootPort();
    return enginePort;
}

/** The port a component's params actually live behind.
 *
 *  Almost always the track's own — but the master chain and the sends are
 *  engine-root keys that carry their own namespace. Reaching them through
 *  `portFor(0)` would namespace the key `ch0:mfx:…`, which the engine does not
 *  know, and send master edits into a synth.
 *
 *  Every path that addresses a component BY KEY — browsing, loading, undo,
 *  module dumps, file params — resolves its port here, so the rule is written
 *  down once instead of at each call site that happens to remember it. */
export function componentPort(index: number, componentKey: string): TrackPort {
    if (isSendComponent(componentKey) || isMasterComponent(componentKey)) return engineRootPort();
    return portFor(index);
}

/** Drop cached ports. Tests use this to swap the ambient host globals. */
export function resetPorts(): void {
    ports.length = 0;
    enginePort = undefined;
}
