/* createMixModel — the Model for the virtual MIX chain slot: movy's own
 * summing mixer as one page (level, pan, the send amounts — design §8). */

import type { Model } from '../model/index.js';
import { createVirtualSlotModel } from '../model/virtual-slot.js';
import { FIELD_AT, LANE_RANGE, type MixFieldName } from './mix-io.js';

/* Schwung draws and edits the page (`chain/own-component-source.ts`, SP-55);
 * the model is the slot's identity, plus the lane range a restored MIX lane is
 * validated against. */
export function createMixModel(_track: number): Model {
    return createVirtualSlotModel('MIX', 'mix', {
        paramRangeByKey(key: string) {
            return FIELD_AT.includes(key as MixFieldName) ? { ...LANE_RANGE } : null;
        },
    });
}
