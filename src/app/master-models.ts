/* The MASTER page's models.
 *
 * `componentPort` and not `portFor(0)`: an `mfx:` key and a send are
 * engine-root keys, which is exactly the choice componentPort makes.
 * `portFor(0)` would namespace them `ch0:…` and send master edits into a synth. */

import { createModel } from '../model/index.js';
import { createScopedLfoModel } from '../lfo/model.js';
import { masterScope } from '../lfo/scope.js';
import { componentPort } from '../track/registry.js';
import { MASTER_FX_SLOTS, isMasterLfoSlot } from '../chain/config.js';
import { appState } from './state.js';

export function buildMasterModels(): void {
    appState.masterFxModels = MASTER_FX_SLOTS.map((s, i) => isMasterLfoSlot(i)
        ? createScopedLfoModel(masterScope())
        : createModel(componentPort(0, s.componentKey), s.componentKey));
    appState.masterChainIndex = 0;
    appState.masterDetail     = false;
}
