/* virtual-page-sources.ts — the registry mapping a virtual component's key to
 * its `PageParamSource` (SP-53).
 *
 * One seam, several components over time: Clip Params today; Set Params and
 * the step page's held-trig contract (SP-54) are mechanical additions to this
 * one function, not a new mechanism (see
 * `plans/sp-53-virtual-component-seam.md`). Kept apart from
 * `renderer/schwung-grid.ts` so that renderer file does not import every
 * component's own contract module by name — one lookup instead, and
 * `renderer/` stays clear of `seq/`'s specifics (R12-adjacent: the renderer
 * asks a question, `seq/` owns the answer).
 */

import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { CLIP_PARAMS_COMPONENT } from '../chain/config.js';
import { clipParamsSource } from './clip-params-contract.js';

export function virtualSourceFor(componentKey: string): PageParamSource | null {
    if (componentKey === CLIP_PARAMS_COMPONENT) return clipParamsSource();
    return null;
}
