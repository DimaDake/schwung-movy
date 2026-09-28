/* held-header-fit.ts — the held-knob header's value, fitted in MOVY'S face.
 *
 * Schwung hands the held header over as whole strings and fits them in its own
 * drawHeader, with its own font. movy draws them with a different one (its 5px
 * face measures differently), so a long value — an LFO Target reading
 * "Mini-JV: Cutoff" — ran into the label. Fitted here against movy's own
 * widths, head first (Schwung's fitHeadTail) so the param is what survives; a
 * plain cut on a Schwung too old to have it.
 */
import type { PageHeader } from './schwung-page-chrome.js';
import { schwungLib, schwungLibAvailable } from './schwung-lib.js';
import { fontWidth } from '../font/index.js';
import { W } from './layout.js';

/* Clear pixels between the label and the value. */
const HEADER_GAP = 4;

export function fitHeldHeader(h: PageHeader): PageHeader {
    const right = h.right ? String(h.right) : '';
    const room = Math.max(0, W - 4 - fontWidth(String(h.left || '')) - HEADER_GAP);
    if (!right || fontWidth(right) <= room) return h;
    const lib = schwungLibAvailable() ? schwungLib() : null;
    const measure = { textWidth: (t: string) => fontWidth(t) };
    let fitted = lib && lib.fitHeadTail ? String(lib.fitHeadTail(measure, right, room)) : right;
    while (fitted.length > 1 && fontWidth(fitted) > room) fitted = fitted.slice(0, -1);
    return { ...h, right: fitted };
}
