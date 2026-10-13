/* page-owner.ts — WHO OWNS THE PAGE UNDER THE 8 KNOBS.
 *
 * Every seam point (`midi/router.ts`, `app/tick.ts`) asks this one question
 * instead of re-deriving it. Seven sites used to, with four different
 * component-key fallbacks, and applying a rule to SOME of them is how a
 * clip-deleting data loss arrived: a gesture asked one planner which parameter
 * was under the finger and the release asked another. The direct accessors are
 * gone — `browser-test/logic/page-owner.mjs` greps for them.
 *
 * THE OWNER IS ALWAYS SCHWUNG'S PAGE (movy's own pages were retired
 * 2026-10-13, tag `movy-pages-final`). A page is built while its module is
 * still loading, so there is a window where its contract has not resolved:
 * through it `page` is null — nothing is drawn, no gesture is taken — and the
 * page must go on being polled or its first empty answer stands for the whole
 * session.
 *
 * A HELD STEP IS NOT A SECOND WINDOW (SP-35). Schwung has no held-step filter,
 * so its page offers eight knobs while only some will take a lock; the offer
 * that cannot be taken is answered at the gesture (`seq/automation.ts`
 * consumes the turn and says why). The dimmed cell is SU-8's territory
 * (`docs/schwung-page-migration.md`).
 *
 * Lives in `app/` because page identity is `appState.activeTrack` and the page
 * cache is `renderer/schwung-grid`: `model/` may not import `renderer/`, and
 * `renderer/` must not grow app state (R12). `page-owner-virtual.ts` is the
 * sibling for a page with no MODEL object at all (SP-53).
 */

import { appState } from './state.js';
import { schwungPageFor } from '../renderer/schwung-grid.js';
import { modulatedKeysOf } from './modulated-keys.js';
import { automationFor } from './automated-keys.js';
import type { SchwungPage } from '../renderer/schwung-page.js';
import { isMasterComponent, isSendComponent, isVirtualPageComponent } from '../chain/config.js';

/* A master, send or VIRTUAL component is not track-scoped: it rides on slot 0
 * as a carrier the way `componentPort` (or, for a virtual component,
 * `schwungPageFor`'s own routing) addresses it, and it is the SAME component
 * regardless of which track the user is looking at. Stamping the active
 * track onto its ref (the only track this file used to know about) gave a
 * master component sixteen distinct page identities — one per track — so a
 * track switch silently swapped in a different cached SchwungPage and a
 * different read cache for the module the user never left (SP-52). A virtual
 * component (SP-53) has no track at all, so it is pinned for the same
 * reason on a component that never HAD one. */
export const MASTER_PAGE_TRACK = 0;

/** Page identity: whose component's parameter pages these are. */
export interface PageRef {
    readonly track: number;
    readonly componentKey: string;
}

export interface PageOwner {
    readonly ref: PageRef | null;
    /** The page, once its contract resolved; null while it is still loading
     *  (or there is no component at all). Null means: draw nothing, take no
     *  gesture. */
    readonly page: SchwungPage | null;
    readonly pageIndex: number;
    readonly pageCount: number;
    /** One line for the device log — the only place the reason is composed. */
    readonly reason: string;
    /** Let the page advance its own contract and read cursor. */
    poll(): void;
    /** What movy's automation layer needs about the parameter at this knob. */
    knobParamInfo(slot: number): any | null;
    changePage(delta: number): void;
    /** Land on page `index` — `changePage(i - at)` jogs one step even at 0 (SP-60). */
    goToPage(index: number): void;
}

/**
 * The component whose pages a model draws, or null when there is none.
 *
 * `getComponentKey` is guarded because `activeModel()` is undefined for an empty
 * chain slot — and a model that cannot name its component has no page.
 */
export function pageRefOf(model: any): PageRef | null {
    if (!model || typeof model.getComponentKey !== 'function') return null;
    const componentKey = model.getComponentKey();
    const track = (isMasterComponent(componentKey) || isSendComponent(componentKey)
                    || isVirtualPageComponent(componentKey))
        ? MASTER_PAGE_TRACK : appState.activeTrack.index;
    return { track, componentKey };
}

const NO_PAGE: PageOwner = {
    ref: null, page: null, pageIndex: 0, pageCount: 0, reason: 'no-model',
    poll() {}, knobParamInfo: () => null, changePage() {}, goToPage() {},
};

export function ownerOf(ref: PageRef, page: SchwungPage): PageOwner {
    /* THE ONE GATE. A page is not live in exactly one window — its contract has
     * not resolved — and every question answers here, so no caller can be
     * given one answer and not the other. Until then there is nothing on
     * screen and nothing under the finger. The hold is deliberately NOT a
     * second term: it was one (SP-33), and SP-18's decoration pass is the
     * price it charged (see the header). */
    const live = () => page.ready;
    return {
        ref,
        get page() { return live() ? page : null; },
        get reason() {
            return (live() ? 'ok' : 'not-ready') + ` track=${ref.track} ck=${ref.componentKey} `
                 + `pages=${page.pageCount}` + (live() ? ` at=${page.pageIndex}` : '');
        },
        get pageIndex() { return live() ? page.pageIndex : 0; },
        get pageCount() { return live() ? page.pageCount : 0; },
        /* OUTSIDE THE GATE at every caller, so a page that is not live keeps
         * asking: the first load sees no hierarchy and without this its empty
         * answer stood for the whole session. */
        poll() { page.tick(); },
        knobParamInfo(slot: number) { return live() ? (page.knobParamInfo(slot) ?? null) : null; },
        changePage(delta: number) { if (live()) page.changePage(delta); },
        goToPage(index: number) { if (live()) page.goToPage(index); },
    };
}

/**
 * The owner of the pages `model` draws — the one question every seam point asks.
 * Cheap enough for the render path: a Map lookup.
 */
export function pageOwnerOf(model: any): PageOwner {
    const ref = pageRefOf(model);
    if (!ref) return NO_PAGE;
    return ownerOf(ref, schwungPageFor(ref.track, ref.componentKey, modulatedKeysOf, automationFor));
}
