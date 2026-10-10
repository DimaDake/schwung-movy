/* The standalone host: movy-host (host/), with no Move beside movy.
 *
 * movy-host registers the same global names shadow_ui does (it answers them
 * natively, or as logged no-ops for the coexistence family), so every call
 * that means the same thing on both hosts reuses the overtake implementation.
 * What differs is the caps and the Move-only calls, which must never be
 * reached — they answer "the host can't" instead of relying on the stubs. */

import type { Platform } from './platform.js';
import { overtakePlatform } from './overtake.js';

export const standalonePlatform: Platform = {
    ...overtakePlatform,
    name: 'standalone',
    caps: { coexistsWithMove: false, canSuspend: false, ownsMasterVolume: true, ownsPowerButton: true },

    powerOff: () => { if (typeof host_power_off === 'function') host_power_off(); },

    suspend: () => {},
    claimLeds: () => false,
    lendSurfaceToMove: () => false,
    excludeMoveFromVolume: () => false,
    canExcludeMoveFromVolume: () => false,
    canInjectToMove: () => false,
    injectToMove: () => {},
    engineInjectReachesMove: () => false,
};

/* movy-host defines `movy_host` before ui.js evaluates; shadow_ui never does. */
export function isStandaloneHost(): boolean {
    return typeof movy_host === 'object' && movy_host !== null && movy_host.flavour === 'standalone';
}
