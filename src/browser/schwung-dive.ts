/* schwung-dive.ts — a non-enum `open` intent becomes movy's file browser.
 *
 * THE CONTROLLER OFFERS, THE HOST OPENS. Clicking a held filepath param asks
 * Schwung's controller for a dive and it answers `{action:"open", key, fullKey,
 * meta}` — with no `options`, because a filepath has none — and then stops:
 * "the controller never opens it itself — that screen belongs to the host."
 * `openSchwungEditor` takes the enum-shaped intents and declines these, so
 * before this file the click was logged and dropped, and under `page` a
 * filepath module could not be given a sample at all.
 *
 * THE INTENT'S OWN KEY, NEVER A RE-DERIVATION. `fullKey` is the controller's
 * component-qualified form and `key` the bare one; both name the ANCHOR of a
 * dive, which is not always the cell that was clicked (a gizmo inside a sample
 * graphic redirects — see `diveTargetAt`). Resolving `(page, slot)` here would
 * re-open the door SP-10 closed and would pick movy's param, which under a
 * delegated page is a different one.
 *
 * WHAT IS TAKEN FROM SCHWUNG AND WHAT FROM MOVY. The directory, the filter and
 * the start hint come from `meta` — the page's own declaration, and the three
 * fields Schwung's `filepath_browser.mjs` reads — because under a delegated
 * page that declaration is the authority. movy supplies only what Schwung has
 * no concept of: the index its own file-value cache stores under, and the
 * preset guard it keeps in its module config. Both are asked BY KEY through
 * `getFileBrowseTarget`, and both are allowed to be absent: a module movy has
 * no config for (mrsample) still gets a browser, just without the memory of
 * which directory the last sample came from.
 *
 * THE COMMIT IS UNCHANGED. The browser this opens is movy's own, and its
 * `activateFileBrowserItem` already writes through `setChainParam` under an
 * `undoableEdit` — the same path every other movy write takes, which is what
 * makes the choice undoable and visible to the SP-26 write-log drain.
 */
import { appState } from '../app/state.js';
import { openFileBrowser } from './file-handler.js';
import type { SchwungIntent, SchwungPage } from '../renderer/schwung-page.js';

/* What movy's own model defaults a file param's root to when nothing declares
 * one (`model/index.ts`, getFileBrowseTarget). */
const DEFAULT_ROOT = '/data/UserData';

/* The two opaque types movy has a screen for. A `canvas`, a `string` and a
 * `wav_position` are divable too, and movy draws none of them: a wav_position
 * is a FLOAT with a picture to movy, not a marker to open. Declining keeps the
 * caller's `schwung-open unhandled` log line, which is the honest report —
 * asserting the dive happened would be worse than the gap. */
const FILE_TYPES = { filepath: true, file: true };

function str(v: any): string { return typeof v === 'string' ? v : ''; }

export function openSchwungDive(intent: SchwungIntent | null, page: SchwungPage,
                                model: any): boolean {
    if (!intent || intent.action !== 'open') return false;
    const meta = intent.meta;
    if (!meta || !FILE_TYPES[meta.type as 'filepath']) return false;

    const fullKey = str(intent.fullKey) || str(intent.key);
    const colon = fullKey.indexOf(':');
    const componentKey = colon > 0 ? fullKey.slice(0, colon) : 'synth';
    const paramKey = colon >= 0 ? fullKey.slice(colon + 1) : fullKey;
    if (!paramKey) return false;

    /* movy's own answers for the same key, or null when its config has none.
     * `gi` is refused below zero by `setFileValue`, so -1 costs the remembered
     * directory and nothing else.
     *
     * BY KEY, NOT THROUGH A SLOT. `getFileBrowseTarget`'s optional argument is
     * a slot resolver, and handing it `() => paramKey` would make the answer
     * depend on `primarySlot()` — movy's own `touchedSlots`, the one piece of
     * state a page Schwung is drawing does not fill. The dive's anchor does not
     * need a slot: `fullKey` names the parameter outright. */
    const own = model && typeof model.fileBrowseTargetForKey === 'function'
        ? model.fileBrowseTargetForKey(paramKey) : null;

    /* "" IS A REAL VALUE — "this param has no file" — AND SO IS "NOT READ YET",
     * AND THEY ARE NOT THE SAME. Both mean "nothing to put the cursor on", so
     * both give null here; what must not happen is `""` reaching the browser as
     * a path, which would open `dirname("")` and land somewhere arbitrary. */
    const values = page.ctl && page.ctl.state ? page.ctl.state.values : null;
    const raw = values ? values[paramKey] : undefined;
    const currentPath = typeof raw === 'string' && raw.length > 0 ? raw : null;

    /* Before openFileBrowser flips the view — the same ordering the router's
     * own file gesture needs, and for the same reason: an origin captured after
     * it is the browser itself, so Back returns to a frozen screen. */
    appState.browseOrigin = appState.currentView;
    openFileBrowser(
        appState.activeTrack.index, componentKey, paramKey,
        own ? own.gi : -1,
        str(meta.root) || (own ? own.root : DEFAULT_ROOT),
        Array.isArray(meta.filter) ? meta.filter.filter((x: any) => typeof x === 'string')
                                   : (own ? own.filter : []),
        str(meta.start_path) || (own ? own.startPath : DEFAULT_ROOT),
        currentPath,
        own ? own.requireContains : undefined,
    );

    /* THE KNOB UNDER YOUR HAND DOES NOT COME BACK. The release for it is routed
     * to whatever screen is up, and that is now this browser — so the
     * controller keeps the slot in `touchOrder`, which latches `touched` and
     * makes the guard on the next jog click swallow it. `clearTouch` is the
     * controller's own name for exactly this hand-off ("when the grid hands off
     * to another screen"), and Schwung's shadow host calls it at the identical
     * point. */
    if (page.ctl && typeof page.ctl.clearTouch === 'function') page.ctl.clearTouch();
    return true;
}
