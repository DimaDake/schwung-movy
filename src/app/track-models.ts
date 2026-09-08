/* Building one track's chain models.
 *
 * Shared because a model CAPTURES its port (`createModelState(port, …)` keeps
 * `state.port`), so a track whose host changes needs its models rebuilt, not
 * just its port re-pointed. `registry.resetPorts()` alone leaves every param
 * page reading the host the track just left — it looks like the flip did
 * nothing until movy is restarted.
 */

import { CHAIN_SLOTS, isLfoSlot, isMixSlot } from '../chain/config.js';
import { createLfoModel } from '../lfo/model.js';
import { createMixModel } from '../mixer/mix-model.js';
import { createModel } from '../model/index.js';
import { portFor } from '../track/registry.js';

/** One model per chain slot for `track`, against whichever host it has NOW. */
export function buildTrackModels(track: number): ReturnType<typeof createModel>[] {
    return CHAIN_SLOTS.map((s, i) => {
        if (isLfoSlot(i)) return createLfoModel(track);
        if (isMixSlot(i)) return createMixModel(track);
        return createModel(portFor(track), s.componentKey);
    }) as ReturnType<typeof createModel>[];
}
