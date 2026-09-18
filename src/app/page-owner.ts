/* page-owner.ts — WHO OWNS THE PAGE UNDER THE 8 KNOBS.
 *
 * movy had no concept of a delegated component. Every seam point re-derived the
 * answer for itself:
 *
 *     const m  = knobModel();
 *     const sp = m ? schwungActiveFor(appState.activeTrack.index,
 *                     m.getComponentKey ? m.getComponentKey() : 'synth') : null;
 *
 * — seven times across `midi/router.ts` and `app/tick.ts`, with four different
 * component-key fallbacks between them. Applying a rule to SOME of the sites is
 * how the migration's eight symptoms arrived, one of them a clip-deleting data
 * loss: a gesture asked Schwung which parameter was under the finger and the
 * release asked movy, so a lane was created against one key and cleared against
 * another.
 *
 * The point of this file is not tidiness. It is that "did you cover every site?"
 * stops being a review question and becomes a structural one, because the direct
 * accessors are gone — `browser-test/logic/page-owner.mjs` greps for them.
 *
 * CLAIMED IS NOT DELEGATED. A page is built while its module is still loading,
 * so there is a window where Schwung is the intended owner and its contract has
 * not resolved. Through that window every gesture is still movy's, which is what
 * the old `p.ready ? p : null` said at each call site — and the page must go on
 * being ticked or its first empty answer stands for the whole session.
 *
 * A HELD STEP IS THE SECOND SUCH WINDOW, and it is here for the reason the
 * first one is: the answer must be given ONCE. SP-18 handed the held-step SCREEN
 * back to movy in `app/tick.ts` — Schwung has no held-step filter, so its page
 * offers eight knobs while only some of them will take a lock, and only movy's
 * body drawer knows which (`hiddenDuringHold` in `renderer/label.ts`). But the
 * gesture sites read OWNERSHIP, not the body, so the screen moved and the knobs
 * did not: under `page` you read movy's labels and locked Schwung's parameters,
 * on every cell where the two planners put different keys — nine of them across
 * the mock presets, by the router's own count. Holding an EMPTY step is where it
 * bit, a step with an occurrence being taken by the step page before either.
 *
 * So the hold belongs to the accessor, and the body is derived from it like the
 * bank bar and the chrome already are. The page is still POLLED through it —
 * `poll()` is outside the gate, exactly as it is for the pre-ready window — so
 * the contract keeps settling under the finger and the page is current when the
 * step is let go.
 *
 * Lives in `app/` because page identity is `appState.activeTrack` and the page
 * cache is `renderer/schwung-grid`: `model/` may not import `renderer/`, and
 * `renderer/` must not grow app state (R12). `app/` already sees both.
 */

import { appState } from './state.js';
import { seqState } from '../seq/state.js';
import { schwungGridMode, schwungPageFor } from '../renderer/schwung-grid.js';
import { modulatedKeysOf } from './modulated-keys.js';
import type { SchwungPage } from '../renderer/schwung-page.js';
import { isMovyOwnComponent } from '../chain/config.js';

/** Page identity: whose component's parameter pages these are. */
export interface PageRef {
    readonly track: number;
    readonly componentKey: string;
}

export interface PageOwner {
    readonly ref: PageRef | null;
    /** Schwung is the intended owner — the mode says so and a module declares it. */
    readonly claimed: boolean;
    /** ...and its contract resolved, so Schwung owns the page NOW. */
    readonly delegated: boolean;
    /** The delegated page, or null while movy still owns it. */
    readonly page: SchwungPage | null;
    /** The page on screen, from whoever owns it: Schwung's index or movy's bank. */
    readonly pageIndex: number;
    readonly pageCount: number;
    /** One line for the device log — the only place the reason is composed. */
    readonly reason: string;
    /** Let a claimed page advance its own contract and read cursor. */
    poll(): void;
    /** What movy's automation layer needs about the parameter at this knob. */
    knobParamInfo(slot: number): any | null;
    /** Page the owner's OWN page set. The two sets have different lengths, so
     *  moving movy's index while Schwung draws lands on a page that does not
     *  exist. */
    changePage(delta: number): void;
}

/**
 * The component whose pages a model draws, or null when there is none.
 *
 * `getComponentKey` is guarded because `activeModel()` is undefined for an empty
 * chain slot — and a model that cannot name its component has no page identity,
 * so the answer is movy's. The old sites invented a key instead ('synth'), which
 * could hand the jog to a Schwung page belonging to a module that is not there.
 */
export function pageRefOf(model: any): PageRef | null {
    if (!model || typeof model.getComponentKey !== 'function') return null;
    return { track: appState.activeTrack.index, componentKey: model.getComponentKey() };
}

/* movy plans, pages and answers. */
function movyOwner(ref: PageRef | null, model: any, reason: string): PageOwner {
    return {
        ref,
        claimed: false,
        delegated: false,
        page: null,
        reason,
        get pageIndex() { return model?.getKnobPage?.() ?? 0; },
        get pageCount() { return model?.getBankCount?.() ?? 1; },
        poll() { /* movy's own polling is model.tick(), driven by app/tick.ts */ },
        knobParamInfo(slot: number) { return model?.getKnobParamInfo?.(slot) ?? null; },
        changePage(delta: number) { model?.changePage?.(delta); },
    };
}

/* Schwung has claimed the component. It answers once its contract resolves, and
 * until then every question falls through to the movy owner underneath — the
 * same object, so the pre-ready window cannot drift from the movy-owned case. */
function delegateOwner(ref: PageRef, page: SchwungPage, fallback: PageOwner): PageOwner {
    /* THE ONE GATE. Both windows in which a claimed page is not the live one —
     * the contract has not resolved, or a step is held — answer here, so no
     * caller can be given one of them and not the other. */
    const live = () => page.ready && !seqState.stepAutoMode;
    return {
        ref,
        claimed: true,
        get delegated() { return live(); },
        get page() { return live() ? page : null; },
        get reason() {
            if (live()) {
                return `ok track=${ref.track} ck=${ref.componentKey} `
                     + `pages=${page.pageCount} at=${page.pageIndex}`;
            }
            return page.ready
                ? `step-held track=${ref.track} ck=${ref.componentKey}`
                : `not-ready track=${ref.track} ck=${ref.componentKey} `
                  + `pages=${page.pageCount}`;
        },
        get pageIndex() { return live() ? page.pageIndex : fallback.pageIndex; },
        get pageCount() { return live() ? page.pageCount : fallback.pageCount; },
        /* OUTSIDE THE GATE at every caller, so a page that is not live keeps
         * asking: the first load sees no hierarchy and without this its empty
         * answer stood for the whole session, and a contract that stopped
         * settling under a held finger would be stale when the step is let go. */
        poll() { page.tick(); },
        knobParamInfo(slot: number) {
            return live() ? (page.knobParamInfo(slot) ?? null)
                          : fallback.knobParamInfo(slot);
        },
        changePage(delta: number) {
            if (live()) page.changePage(delta); else fallback.changePage(delta);
        },
    };
}

/**
 * The owner of the pages `model` draws — the one question every seam point asks.
 *
 * Cheap enough for the render path: the mode is a map read and the page is a
 * Map lookup, which is exactly what each of the old call sites already paid.
 */
export function pageOwnerOf(model: any): PageOwner {
    const ref = pageRefOf(model);
    if (!ref) return movyOwner(null, model, 'no-model');

    const mode = schwungGridMode();
    if (mode !== 'page') return movyOwner(ref, model, 'mode=' + mode);
    if (isMovyOwnComponent(ref.componentKey)) {
        return movyOwner(ref, model, 'movy-page ck=' + ref.componentKey);
    }
    return delegateOwner(ref, schwungPageFor(ref.track, ref.componentKey, modulatedKeysOf),
                         movyOwner(ref, model, ''));
}
