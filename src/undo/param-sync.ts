/* Push restored param values back into the models that display them.
 *
 * Undo writes chain params straight into the DSP — that is the inverse, and it
 * has to reach the sound immediately. But movy's knobs read from each model's
 * own mirror, and that mirror only re-reads on a slow round-robin. Without this
 * an undo changed the sound while the screen kept showing the value it had just
 * taken back, which reads as "undo didn't work" even though it did.
 *
 * Lives in undo/ rather than apply.ts so apply.ts keeps no import of app state. */

import { appState } from '../app/state.js';
import type { ParamOp } from './types.js';

export function syncParamsToModels(ops: ParamOp[]): void {
    for (const op of ops) {
        const colon = op.key.indexOf(':');
        if (colon <= 0) continue;
        const componentKey = op.key.slice(0, colon);
        const ioKey = op.key.slice(colon + 1);
        const models = appState.trackModels[op.slot];
        if (!models) continue;
        for (const m of models) {
            if (m.getComponentKey() === componentKey && m.refreshParamKey(ioKey)) break;
        }
    }
    appState.dirty = true;
}
