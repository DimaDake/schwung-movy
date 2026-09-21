/* schwung-grid.ts — the registry that lets Schwung own a track's param pages.
 *
 * One SchwungPage per (track, component). Held here rather than on the model so
 * that turning the mode off leaves movy's own model untouched and authoritative
 * — the swap is reversible at runtime, which is the only way to judge it on a
 * device.
 *
 * MODE
 *   'off'   movy plans and draws (unchanged)
 *   'page'  SCHWUNG plans AND draws; movy targets the parameters
 *
 * There used to be a third mode, 'body' (movy plans, Schwung only draws the
 * widgets) — deleted in SP-40 along with its renderer, schwung-body.ts. It
 * never earned a release opinion, and it differed from 'page' only in which
 * side drew pixels, never in what was decided.
 *
 * 'page' is the one this exists for. Under it the Schwung page index is the
 * truth and movy's own bank index is not consulted for drawing, because the two
 * page sets are different lengths — Schwung paginates overflow, so mirroring
 * one index onto the other would point at a page that does not exist.
 */

import { createSchwungPage, type SchwungPage } from './schwung-page.js';
import type { PageAutomation } from '../types/page-automation.js';
import { componentPort } from '../track/registry.js';
import { schwungLibAvailable } from './schwung-lib.js';
import { schwungFloorMetOnce } from './schwung-floor.js';
import { flagValue } from '../seq/flags.js';
import { isMovyOwnComponent, isVirtualPageComponent } from '../chain/config.js';
import { virtualSourceFor } from '../seq/virtual-page-sources.js';
import { ownComponentSourceFor } from '../chain/own-component-source.js';
import { mlog } from '../log.js';

export type SchwungGridMode = 'off' | 'page';

/* One SchwungPage per (track, component). */
const pages = new Map<string, SchwungPage>();

/* The flag's two values, in the order the Settings row lists them. */
const MODES: SchwungGridMode[] = ['off', 'page'];

/*
 * THE MODE IS A SETTING NOW, NOT A BUILD.
 *
 * It was `__MOVY_SCHWUNG_GRID__`, a define, on the reasoning that an ordinary
 * build must not ship the experiment by forgetting a call. The define could not
 * stay: a build-time switch has to compile ONE renderer in, and a user-facing
 * switch needs both. What actually kept an ordinary build safe was never the
 * define — it was the `.off` module swap that took the param_pages imports out
 * of the graph, and schwung-lib.ts now does that job at runtime instead, so a
 * Schwung that cannot serve the library costs nothing but this feature.
 *
 * READ THROUGH THE LIBRARY GATE, EVERY TIME. `flagValue` is a map read, so
 * there is nothing to cache, and caching would be the bug: the flag is edited
 * on a page the user can reach while a module is on screen, and a stale mode
 * would leave Schwung's controller driving input into a body movy is drawing.
 * Pinning to 'off' when the library is unavailable is what makes the setting
 * safe to expose at all — otherwise choosing DRAW on an old Schwung would take
 * the screen to a renderer that cannot run.
 *
 * THE VERSION FLOOR PINS IT THE SAME WAY, and for the same reason. Availability
 * is not vintage: a Schwung with every param_pages file but an older
 * `page_plan.mjs` imports far enough to fail on a missing export, so the six
 * modules are present and the renderer behind them still cannot run. The two
 * are one clause because they are one question — can Schwung serve what the
 * flag is offering — and a mode that answered it in two places would be a mode
 * that could disagree with itself. `schwungFloorMetOnce` is the read-once form
 * deliberately: this clause is asked on every rendered frame and every knob
 * event, so the one `host_read_file` behind its answer is paid at the first of
 * them rather than on each — which is the shape Schwung's read budget is about.
 */
let override: SchwungGridMode | null = null;
let lastMode: SchwungGridMode | null = null;

export function schwungGridMode(): SchwungGridMode {
    const m = (!schwungLibAvailable() || !schwungFloorMetOnce()) ? 'off'
            : override !== null ? override
            : (MODES[flagValue('schwunggrid')] ?? 'off');
    /*
     * A CHANGED MODE DROPS THE CACHED PAGES, here rather than in a hook on
     * `setFlag`.
     *
     * A hook would be the obvious place, and it would make flags.ts import this
     * module while this one imports flags.ts — a cycle whose failure mode is a
     * TDZ at load, i.e. movy not starting. Noticing the change where the value
     * is already being read costs one string compare on a call that is already
     * a map lookup, and it catches every route into the flag: the Settings
     * knob, a prefs.json edited on disk, and the test override.
     *
     * It matters because a SchwungPage caches a controller bound to a
     * component's contract. Coming back to PAGE with a stale one would draw the
     * page the module had before the user went and changed it.
     */
    if (m !== lastMode) {
        lastMode = m;
        pages.clear();
    }
    return m;
}

/*
 * FOR TESTS AND THE DEVICE PROBE ONLY.
 *
 * An override, not the source: setting it writes no flag and survives no
 * reload, so a suite can pin a mode without touching prefs.json and without
 * the next `flagValue` read contradicting it. `null` means "ask the flag",
 * which is what production always does.
 */
export function setSchwungGridMode(m: SchwungGridMode | null): void {
    override = m;
}

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
         * Otherwise `componentPort`, not `portFor(trackIndex)`: a `master_fx:`
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
        animating: () => false, render() {}, chrome: () => ({ header: null, footer: null, pageLabel: null }),
        knobTurn() {}, knobTouch() {}, click: () => null, back: () => null,
        focusVoice: () => false, ready: false, ctl: null,
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

/*
 * WHETHER SCHWUNG IS DRIVING IS NOT ASKED HERE.
 *
 * This file used to export `schwungActiveFor` (the mode + a ready check) and
 * `schwungChangePage` (the same, plus a jog), and every seam point called one of
 * them with a component key it derived itself. The ownership question now has
 * exactly one answer, in `app/page-owner.ts`, which is the only caller of
 * `schwungPageFor` — see `browser-test/logic/page-owner.mjs`, which greps for a
 * second one. What is left here is the mode and the cache.
 */
