/* param-body.ts — which body fills the knob rows, decided in one place.
 *
 * SP-58. Every app render site gets its body from here, so a site cannot
 * silently draw something other than the page the knobs are writing through.
 * The body is Schwung's page, or NOTHING while that page's contract is still
 * resolving (`page-owner.ts`): no rows, rather than a guess.
 */

import type { PageOwner } from './page-owner.js';

const NOTHING = (): void => {};

/* Whose body the last rendered frame drew — the device probe's reading, since
 * a screen grab cannot tell an empty row from a loading one. */
let lastBody: 'schwung' | 'none' = 'none';
let lastOwner: PageOwner | null = null;

export function paramBodyFor(owner: PageOwner, schwungBody: (() => void) | undefined): () => void {
    lastBody = schwungBody ? 'schwung' : 'none';
    lastOwner = schwungBody ? owner : null;
    return schwungBody ?? NOTHING;
}

/** Whose body the most recent param frame drew. */
export function lastParamBody(): 'schwung' | 'none' { return lastBody; }

/** The Schwung page the last frame drew, read live; null when nothing was. */
export function lastSchwungPage(): { pageIndex: number; pageCount: number;
                                     keys: (string | null)[] } | null {
    const page = lastOwner && lastOwner.page;
    if (!page) return null;
    const keys: (string | null)[] = [];
    for (let slot = 0; slot < 8; slot++) keys.push(page.keyAt(slot));
    return { pageIndex: page.pageIndex, pageCount: page.pageCount, keys };
}
