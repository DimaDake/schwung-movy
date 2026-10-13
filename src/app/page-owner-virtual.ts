/* page-owner-virtual.ts — WHO OWNS A PAGE WITH NO MODEL BEHIND IT.
 *
 * Set Params, Clip Params and the step page (SP-53/54) have no `Model`: they
 * answer out of `seqState`/`keyboardState` through a virtual page source. This
 * is `pageOwnerOf`'s sibling for that case, split out to keep `page-owner.ts`
 * under the 200-line cap — the ownership rule itself (`ownerOf`) is shared.
 */

import { schwungPageFor } from '../renderer/schwung-grid.js';
import { ownerOf, MASTER_PAGE_TRACK, type PageOwner, type PageRef } from './page-owner.js';

export function pageOwnerForComponent(componentKey: string): PageOwner {
    const ref: PageRef = { track: MASTER_PAGE_TRACK, componentKey };
    return ownerOf(ref, schwungPageFor(ref.track, componentKey, null, null));
}
