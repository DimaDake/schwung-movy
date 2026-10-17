/* Writing one LFO value through a scope's port, as an undoable edit. */

import { setChainParam } from '../chain/set-param.js';
import { beginGesture } from '../undo/edit.js';
import type { LfoScope } from './scope.js';

/** An edit addressed by its FULL key (`mfx:lfo2:depth`) — what Schwung's LFO
 *  page writes, since its contract declares real keys. */
export function writeLfoKey(scope: LfoScope, full: string, val: string): void {
    const old = scope.port.getParam(full);
    const field = full.slice(full.lastIndexOf(':') + 1);
    beginGesture('lfo:' + scope.id + ':' + full, field.toUpperCase(), scope.label, false);
    setChainParam(scope.port, full, val, old);
}
