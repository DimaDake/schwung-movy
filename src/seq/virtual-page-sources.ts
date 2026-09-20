/* virtual-page-sources.ts — the registry mapping a virtual component's key to
 * its `PageParamSource` (SP-53).
 *
 * One seam, several components: Clip Params and Set Params today; the step
 * page's held-trig contract (SP-54) is a mechanical addition to this one
 * function, not a new mechanism (see `plans/sp-53-virtual-component-seam.md`).
 * Kept apart from `renderer/schwung-grid.ts` so that renderer file does not
 * import every component's own contract module by name — one lookup instead,
 * and `renderer/` stays clear of `seq/`'s specifics (R12-adjacent: the
 * renderer asks a question, `seq/` owns the answer).
 */

import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { CLIP_PARAMS_COMPONENT, SET_PARAMS_COMPONENT } from '../chain/config.js';
import { clipParamsSource } from './clip-params-contract.js';
import { setParamsSource } from './set-params-contract.js';

export function virtualSourceFor(componentKey: string): PageParamSource | null {
    if (componentKey === CLIP_PARAMS_COMPONENT) return clipParamsSource();
    if (componentKey === SET_PARAMS_COMPONENT) return setParamsSource();
    return null;
}
