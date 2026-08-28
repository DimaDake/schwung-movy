/* schwung-grid.ts — the registry that lets Schwung own a track's param pages.
 *
 * One SchwungPage per (track, component). Held here rather than on the model so
 * that turning the mode off leaves movy's own model untouched and authoritative
 * — the swap is reversible at runtime, which is the only way to judge it on a
 * device.
 *
 * MODE
 *   'off'   movy plans and draws (unchanged)
 *   'body'  movy plans, Schwung draws the widgets (schwung-body.ts)
 *   'page'  SCHWUNG plans AND draws; movy targets the parameters
 *
 * 'page' is the one this exists for. Under it the Schwung page index is the
 * truth and movy's own bank index is not consulted for drawing, because the two
 * page sets are different lengths — Schwung paginates overflow, so mirroring
 * one index onto the other would point at a page that does not exist.
 */

import { createSchwungPage, type SchwungPage } from './schwung-page.js';
import { portFor } from '../track/registry.js';

export type SchwungGridMode = 'off' | 'body' | 'page';

let mode: SchwungGridMode = 'off';
export function schwungGridMode(): SchwungGridMode { return mode; }
export function setSchwungGridMode(m: SchwungGridMode): void { mode = m; }

const pages = new Map<string, SchwungPage>();

export function schwungPageFor(trackIndex: number, componentKey: string): SchwungPage {
    const id = trackIndex + ':' + componentKey;
    let p = pages.get(id);
    if (!p) {
        p = createSchwungPage(portFor(trackIndex), componentKey);
        p.reload();
        pages.set(id, p);
    }
    return p;
}

/** Drop cached pages for a track — its module changed, so its contract has. */
export function schwungGridReload(trackIndex?: number): void {
    if (trackIndex === undefined) { pages.clear(); return; }
    for (const k of [...pages.keys()]) if (k.startsWith(trackIndex + ':')) pages.delete(k);
}

/** Jog moved a page. Returns true when Schwung owned the move. */
export function schwungChangePage(trackIndex: number, componentKey: string, delta: number): boolean {
    if (mode !== 'page') return false;
    const p = schwungPageFor(trackIndex, componentKey);
    if (!p.ready) return false;
    p.changePage(delta);
    return true;
}
