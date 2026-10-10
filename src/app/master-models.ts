/* The MASTER page's models, built over whichever master is bound.
 *
 * `componentPort` and not `portFor(0)`: a `master_fx:` key is global and the
 * slot it rides on is only a carrier, an `mfx:` key and a send are engine-root
 * keys — three destinations, which is exactly the choice componentPort makes.
 * `portFor(0)` would namespace them `ch0:…` and send master edits into a synth. */

import { createModel } from '../model/index.js';
import { createScopedLfoModel } from '../lfo/model.js';
import { masterScope } from '../lfo/scope.js';
import { componentPort } from '../track/registry.js';
import { MASTER_FX_SLOTS, isMasterLfoSlot } from '../chain/config.js';
import { bindMaster, pushMasterBinding, setMasterBindingOverride } from '../chain/master-binding.js';
import { masterPrefix } from '../chain/master-prefix.js';
import { requestMasterImport } from '../chain/master-import.js';
import { paramSet } from '../host/param.js';
import { appState } from './state.js';

/** Bind the master, then build its models over the bound keys. */
export function buildMasterModels(): void {
    bindMaster();
    appState.masterFxModels = MASTER_FX_SLOTS.map((s, i) => isMasterLfoSlot(i)
        ? createScopedLfoModel(masterScope())
        : createModel(componentPort(0, s.componentKey), s.componentKey));
    appState.masterChainIndex = 0;
    appState.masterDetail     = false;
}

/** The probe's seam: rebind live (null = what host and flag say), tell the
 *  engine, and check the Set for an import. Writes nothing durable on the UI
 *  side — the override dies with the session, like `setGridMode`'s. */
export function rebindMasterForTest(movy: boolean | null): string {
    setMasterBindingOverride(movy);
    buildMasterModels();
    pushMasterBinding((k, v) => { paramSet(k, v); });
    requestMasterImport();
    return masterPrefix();
}
