/* page-owner-virtual.ts — WHO OWNS A PAGE WITH NO MODEL BEHIND IT.
 *
 * `page-owner.ts`'s `pageOwnerOf(model)` needs a `model` with
 * `getComponentKey()`/`getKnobPage()`/etc — the fallback answer when Schwung
 * has not claimed the page. Set Params and Clip Params (SP-53) have no such
 * object: they answer out of `seqState`/`keyboardState` directly through a
 * handful of standalone `build*PageVM()` functions, not a `Model`. This file
 * is the sibling question for that case, split out only to keep
 * `page-owner.ts` under the 200-line cap — the ownership rule itself
 * (`delegateOwner`, imported rather than restated) is unchanged.
 */

import { schwungGridMode, schwungPageFor } from '../renderer/schwung-grid.js';
import { delegateOwner, MASTER_PAGE_TRACK, type PageOwner, type PageRef } from './page-owner.js';

/**
 * Same question as `pageOwnerOf`, for a page with no module-shaped MODEL at
 * all. The movy-owned fallback here is always page 0 of 1, which is what
 * these pages have always been — a single fixed grid, no banks, no jog.
 */
export function pageOwnerForComponent(componentKey: string): PageOwner {
    const ref: PageRef = { track: MASTER_PAGE_TRACK, componentKey };
    const single: PageOwner = {
        ref, claimed: false, delegated: false, page: null, reason: 'movy-page-fixed',
        pageIndex: 0, pageCount: 1,
        poll() { /* movy's own page has nothing to poll — its vm is rebuilt per tick */ },
        knobParamInfo() { return null; },   // no automation on either page today
        changePage() { /* neither page has a jog */ },
    };
    if (schwungGridMode() !== 'page') return single;
    return delegateOwner(ref, schwungPageFor(ref.track, componentKey, null, null), single);
}
