/* schwung-grid.ts — the cache of Schwung param pages: one SchwungPage per
 * (track, component). Schwung plans AND draws every param page; movy targets
 * the parameters. (movy's own pages were retired 2026-10-13 — tag
 * `movy-pages-final`, docs/movy-pages-knowhow.md.)
 *
 * The Schwung page index is the only page index: movy's model keeps no bank of
 * its own to mirror, because the two planners paginate differently.
 */

import { createSchwungPage, type SchwungPage } from './schwung-page.js';
import { STILL } from './schwung-page-anim.js';
import type { PageAutomation } from '../types/page-automation.js';
import { componentPort } from '../track/registry.js';
import { isMovyOwnComponent, isVirtualPageComponent } from '../chain/config.js';
import { virtualSourceFor } from '../seq/virtual-page-sources.js';
import { ownComponentSourceFor } from '../chain/own-component-source.js';
import { mlog } from '../log.js';

/* One SchwungPage per (track, component). */
const pages = new Map<string, SchwungPage>();

/** The lookup the page asks for its modulation, supplied by the app layer.
 *
 * Passed in rather than imported because the set lives on the model, and a model
 * is app state (R12). Held as a parameter on this one function rather than as a
 * module-level slot so that a page carries the answer IT was built with: the
 * cache below is keyed by track and component, and a global would let the last
 * caller decide for every page. `app/page-owner.ts` is the only caller. */
export function schwungPageFor(trackIndex: number, componentKey: string,
                               modulatedOf?: ((track: number, componentKey: string) => ReadonlySet<string> | null) | null,
                               automationOf?: ((track: number) => PageAutomation) | null,
): SchwungPage {
    const id = trackIndex + ':' + componentKey;
    let p = pages.get(id);
    if (!p) {
        /* A VIRTUAL COMPONENT (SP-53) HAS NO PORT AT ALL — its io answers out
         * of movy's own state, never a track's chain, so it is resolved
         * BEFORE `componentPort` rather than through it: `componentPort`'s own
         * contract is "the port a component's params actually live behind",
         * and a virtual component's params live behind no port.
         *
         * Otherwise `componentPort`, not `portFor(trackIndex)`: a `mfx:`
         * key is schwung's own and global, and a `snd<n>` key is movy's engine
         * root — neither is the track's own chain. Reaching either through the
         * plain track port namespaces the key `ch<N>:…`, which is the one
         * `componentPort` exists to prevent (`track/registry.ts`). Correct here
         * only because `trackIndex` is already the fixed carrier `pageRefOf`
         * hands a non-track component (master/send/virtual —
         * `app/page-owner.ts`), not the active track. */
        /* MIX/LFO (SP-55) have a real port but no per-cell engine keys that
         * line up with Schwung's flat namespace (see `isMovyOwnComponent`'s
         * own comment in chain/config.ts) — resolved before `componentPort`
         * for the same reason a virtual component is: there is a translation
         * to do that a bare port cannot do for itself. */
        const source = isVirtualPageComponent(componentKey)
            ? virtualSourceFor(componentKey)
            : isMovyOwnComponent(componentKey)
                ? ownComponentSourceFor(trackIndex, componentKey)
                : componentPort(trackIndex, componentKey);
        if (!source) return pages.get(id) ?? deadPage(componentKey);
        p = createSchwungPage(source, componentKey,
                              modulatedOf ?? null, automationOf ?? null, trackIndex);
        p.reload();
        pages.set(id, p);
    }
    return p;
}

/* A registered virtual key with no source (a config bug, not a runtime one —
 * `isVirtualPageComponent` and `virtualSourceFor` are meant to agree on every
 * key) still has to return SOMETHING typed `SchwungPage`, never throw: this
 * runs on the render path. `ready` stays false forever, which is the same
 * "not claimed yet" state a module still loading shows — never drawn, never
 * mistaken for an empty page. */
function deadPage(componentKey: string): SchwungPage {
    mlog('schwung-grid: no virtual source for ' + componentKey);
    return {
        reload() {}, tick() {}, pageCount: 0, pageIndex: 0,
        changePage() {}, goToPage() {}, keyAt: () => null, targetAt: () => null,
        labelAt: () => null, knobParamInfo: () => null, knobLevels: () => new Array(8).fill(null),
        marks: () => 0,
        animating: () => STILL, peekOpen: () => false, render() {}, chrome: () => ({ header: null, footer: null, pageLabel: null, padScoped: false }), regularKnobAt: () => false,
        knobTurn() {}, knobTouch() {}, click: () => null, back: () => null,
        focusVoice: () => false, focusWritten() {}, picker: () => null, claimsBottomBand: () => false,
        ready: false, ctl: null,
    };
}

/** Drop cached pages for a track — its module changed, so its contract has. */
export function schwungGridReload(trackIndex?: number): void {
    if (trackIndex === undefined) { pages.clear(); return; }
    for (const k of [...pages.keys()]) if (k.startsWith(trackIndex + ':')) pages.delete(k);
}

/** Drop exactly ONE cached page, never its neighbours (SP-54). A track-scoped
 *  `schwungGridReload(trackIndex)` is too coarse for a component whose
 *  lifetime is shorter than the track's own: the step page shares its fixed
 *  carrier with Clip Params/Set Params/MFX/SEND (or, addressed by the watched
 *  track instead, with that track's own module page), so evicting by track
 *  would force an unrelated re-plan every time a step is released — the exact
 *  cost this exists to avoid paying for nothing. */
export function schwungGridDrop(trackIndex: number, componentKey: string): void {
    pages.delete(trackIndex + ':' + componentKey);
}

/* WHETHER SCHWUNG IS DRIVING IS NOT ASKED HERE: `app/page-owner.ts` is the
 * only caller of `schwungPageFor` (`browser-test/logic/page-owner.mjs` greps
 * for a second one). */
