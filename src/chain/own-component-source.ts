/* own-component-source.ts — the `PageParamSource` for a component `isMovyOwnComponent`
 * names (SP-55: MIX, the track LFO, the master LFO).
 *
 * Split from `schwung-grid.ts` (which stays render/cache plumbing) and from
 * `mixer/`/`lfo/` (which stay ignorant of Schwung) so the one file that knows
 * both sides — "here is a component key and a track" / "here is where its
 * cells actually live" — is this one, matching `own-component-source`'s
 * sibling `virtual-page-sources.ts` for SP-53's components.
 */

import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { mixSchwungSource } from '../mixer/mix-schwung-cells.js';
import { lfoSchwungSource } from '../lfo/lfo-schwung-cells.js';
import { trackScope, masterScope } from '../lfo/scope.js';
import { isLfoComponent } from './config.js';

export function ownComponentSourceFor(track: number, componentKey: string): PageParamSource | null {
    if (componentKey === 'mix') return mixSchwungSource(track);
    if (isLfoComponent(componentKey)) {
        /* Same rule `componentPort` applies for a real module: `master_fx:`
         * is schwung's own and global, riding on the fixed carrier slot
         * (`MASTER_PAGE_TRACK`, already what `trackIndex` IS here for this
         * component — see `pageRefOf`'s `isMasterComponent` branch); the
         * track's own LFO uses the track actually on screen. */
        const scope = componentKey.startsWith('master_fx') ? masterScope() : trackScope(track);
        return lfoSchwungSource(scope);
    }
    return null;
}
