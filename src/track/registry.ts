/* Index -> port, cached.
 *
 * Ports are looked up on every param read, and reads happen per tick — building
 * one per call would allocate in the hot path. */

import { HostSlotPort } from './host-port.js';
import { MovyChainPort } from './movy-chain-port.js';
import { EngineRootPort } from './send-port.js';
import type { TrackPort } from './port.js';
import { trackKind } from './ref.js';
import { isMasterComponent, isSendComponent } from '../chain/config.js';

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

/** A schwung shadow slot, whatever `chtracks` says a track is.
 *
 *  For keys that are NOT a track's: `master_fx:…` is global to schwung and only
 *  rides on a slot number as a carrier. Reaching it through `portFor(0)` worked
 *  until track 0 could become a movy chain — then the chain port namespaces it
 *  as `ch0:master_fx:…` and the master chain's edits land in a synth. */
const hostPorts: (TrackPort | undefined)[] = [];

let enginePort: TrackPort | undefined;

/** Params addressed at movy's engine root — today the two send buses, whose
 *  component key already names the destination. Not a track and not a shadow
 *  slot; see `EngineRootPort`. */
export function engineRootPort(): TrackPort {
    if (!enginePort) enginePort = new EngineRootPort();
    return enginePort;
}

export function hostPort(slot: number): TrackPort {
    let p = hostPorts[slot];
    if (!p) {
        p = new HostSlotPort(slot);
        hostPorts[slot] = p;
    }
    return p;
}

/** The port a component's params actually live behind.
 *
 *  Almost always the track's own — but a `master_fx:` component is schwung's,
 *  global, and merely rides on slot 0. Reaching it through `portFor(0)` worked
 *  until `chtracks` could make track 0 a movy chain: the chain port then
 *  namespaces the key `ch0:master_fx:…`, which movy's engine does not know, so
 *  a master FX module could not be loaded at all.
 *
 *  Every path that addresses a component BY KEY — browsing, loading, undo,
 *  module dumps, file params — resolves its port here, so the rule is written
 *  down once instead of at each call site that happens to remember it. */
export function componentPort(index: number, componentKey: string): TrackPort {
    if (isSendComponent(componentKey)) return engineRootPort();
    return isMasterComponent(componentKey) ? hostPort(0) : portFor(index);
}

/** Drop cached ports. Tests use this to swap the ambient shadow_* globals. */
export function resetPorts(): void {
    ports.length = 0;
    hostPorts.length = 0;
    enginePort = undefined;
}
