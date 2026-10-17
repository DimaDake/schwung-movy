/* The LFO chain slot's Model — a track's two slot LFOs, or the master chain's.
 * Schwung draws and edits the page (`lfo-schwung-source.ts`, SP-60); the
 * model is the slot's identity. */

import type { Model } from '../model/index.js';
import { createVirtualSlotModel } from '../model/virtual-slot.js';
import { trackScope, type LfoScope } from './scope.js';

/** A track's own LFO page. */
export function createLfoModel(track: number): Model {
    return createScopedLfoModel(trackScope(track));
}

export function createScopedLfoModel(scope: LfoScope): Model {
    return createVirtualSlotModel('LFO', scope.keyPrefix + 'lfo');
}
