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
import { isMixerKey } from '../mixer/mix-io.js';
import type { ParamOp } from './types.js';

/** A whole-module restore changed everything at once, so there is no key list
 *  to walk — tell the slot's models to re-read from scratch. */
export function refreshModels(slot: number): void {
    for (const m of appState.trackModels[slot] ?? []) m.reload();
    appState.dirty = true;
}

export function syncParamsToModels(ops: ParamOp[]): void {
    for (const op of ops) {
        /* The mixer is checked FIRST, because neither of its keys is
         * `<component>:<param>` and the split below therefore cannot find its
         * page. A movy track's write is the bare `mix` — no colon at all, so it
         * was skipped outright — and a host track's is `slot:volume`, which
         * names schwung's slot and matches no model. Either way the MIX page
         * never re-read, so an undone edit moved the sound and left the knob
         * sitting where the user had just turned it.
         *
         * The page ignores the field name (it caches the whole mixer value and
         * drops it whole), so the key goes through as-is. */
        let componentKey: string;
        let ioKey: string;
        if (isMixerKey(op.key)) {
            componentKey = 'mix';
            ioKey = op.key;
        } else {
            const colon = op.key.indexOf(':');
            if (colon <= 0) continue;
            componentKey = op.key.slice(0, colon);
            ioKey = op.key.slice(colon + 1);
        }
        const models = appState.trackModels[op.slot];
        if (!models) continue;
        /* A slot LFO param is written as `lfo1:rate_hz`, but the track's LFO
         * page presents BOTH LFOs as one virtual component keyed 'lfo' — so the
         * prefix has to be mapped or the page is never found and never
         * repaints. */
        const target = /^lfo\d+$/.test(componentKey) ? 'lfo' : componentKey;
        for (const m of models) {
            if (m.getComponentKey() === target && m.refreshParamKey(ioKey)) break;
        }
    }
    appState.dirty = true;
}
