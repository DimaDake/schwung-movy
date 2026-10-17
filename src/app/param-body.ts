/* param-body.ts — which body fills the knob rows, decided in one place.
 *
 * SP-58. Every app render site gets its body from here, so a site cannot
 * silently draw something other than the page the knobs are writing through.
 * The body is Schwung's page, or NOTHING while that page's contract is still
 * resolving (`page-owner.ts`): no rows, rather than a guess.
 */

import type { PageOwner } from './page-owner.js';
import type { AutomationView } from '../types/viewmodel.js';

const NOTHING = (): void => {};

/* Whose body the last rendered frame drew — the device probe's reading, since
 * a screen grab cannot tell an empty row from a loading one. */
let lastBody: 'schwung' | 'none' = 'none';
let lastOwner: PageOwner | null = null;
let lastAuto: AutomationView | undefined;

/** `auto` is the automation view the frame is drawn with — what the probe's
 *  cells read a held or live-recorded lane from. */
export function paramBodyFor(owner: PageOwner, schwungBody: (() => void) | undefined,
                             auto?: AutomationView): () => void {
    lastBody = schwungBody ? 'schwung' : 'none';
    lastOwner = schwungBody ? owner : null;
    lastAuto = auto;
    return schwungBody ?? NOTHING;
}

/** Whose body the most recent param frame drew. */
export function lastParamBody(): 'schwung' | 'none' { return lastBody; }

/** One knob cell as the device probe reports it. */
export interface DrawnCell { name: string; value: string; automated: boolean;
                             touched: boolean; modulated: boolean }

/** The eight cells the last frame drew, read live off the page: the label, the
 *  marks the page wears (bit `slot` modulated, bit `8 + slot` a lane — see
 *  `marks()`), and which cell is "touched" with what value. A cell is touched
 *  when the controller holds it (its header readout is the value) or when a
 *  held step or live take is writing its lane — a turn the automation layer
 *  consumes never reaches the controller, so the lane's value IS the reading,
 *  as `schwung-page-decorations.ts` draws it. Null where nothing is bound. */
export function lastDrawnCells(): (DrawnCell | null)[] {
    const page = lastOwner && lastOwner.page;
    const cells: (DrawnCell | null)[] = new Array(8).fill(null);
    if (!page) return cells;
    const marks = page.marks();
    const touched = page.ctl?.state?.touched ?? -1;
    const held = touched >= 0 ? page.chrome(false).header : null;
    const levels = page.knobLevels();
    for (let slot = 0; slot < 8; slot++) {
        const key = page.keyAt(slot);
        if (!key) continue;
        const lane = lastAuto ? lastAuto.laneForKey(key) : -1;
        const laneValue = lane < 0 ? undefined
            : (lastAuto!.held ? lastAuto!.heldValues.get(lane) : undefined) ?? lastAuto!.liveValues.get(lane);
        const level = levels[slot];
        cells[slot] = {
            name:      page.labelAt(slot) ?? key,
            value:     laneValue !== undefined ? String(laneValue)
                       : slot === touched && held?.right ? String(held.right)
                       : level === null ? '' : level.toFixed(3),
            automated: !!(marks & (1 << (8 + slot)))
                       || (lane >= 0 && (lastAuto!.activeLanes & (1 << lane)) !== 0),
            touched:   slot === touched || laneValue !== undefined,
            modulated: !!(marks & (1 << slot)),
        };
    }
    return cells;
}

/** The Schwung page the last frame drew, read live; null when nothing was. */
export function lastSchwungPage(): { pageIndex: number; pageCount: number;
                                     keys: (string | null)[] } | null {
    const page = lastOwner && lastOwner.page;
    if (!page) return null;
    const keys: (string | null)[] = [];
    for (let slot = 0; slot < 8; slot++) keys.push(page.keyAt(slot));
    return { pageIndex: page.pageIndex, pageCount: page.pageCount, keys };
}
