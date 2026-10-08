/* param-body.ts — which body fills the knob rows, decided in one place.
 *
 * SP-58. movy draws a module's knobs from more than one screen, and each render
 * site used to hand its renderer Schwung's body OR NOTHING — nothing meaning
 * movy's own `drawKnobParams`, silently. The master chain view was a site that
 * handed nothing while its knobs already wrote through Schwung's page, so the
 * labels on screen were movy's page set and the edits were Schwung's. Nothing
 * reported it, because declining was indistinguishable from never being asked.
 *
 * So every app render site now gets its body from here, and the fallback asks
 * the one question that separates a legitimate movy body from a defect: is the
 * owner of the params on screen LIVE under Schwung? `delegated` is `page.ready`
 * (`page-owner.ts`), so mode `off`, an unclaimed module and a contract still
 * resolving are all false and fall back quietly. Only a live page reaching the
 * fallback trips — which is by definition a site that forgot to ask.
 *
 * The renderers keep their optional body argument for `screenshot.mjs`; the app
 * never omits it (pinned structurally by browser-test/logic/param-body.mjs).
 */

import type { ViewModel } from '../types/viewmodel.js';
import type { PageOwner } from './page-owner.js';
import { drawKnobParams } from '../renderer/label.js';
import { mlog } from '../log.js';

let trips = 0;
let lastTrip = '';
/* Whose body the last rendered frame drew — the device probe's reading, since
 * a screen grab cannot tell Schwung's cells from movy's without re-encoding
 * both renderers. */
let lastBody: 'schwung' | 'movy' = 'movy';
/* WHICH Schwung page that body was. movy's view model goes on describing movy's
 * own bank while Schwung draws, and the two plans disagree (mrsample: movy has
 * 8 banks, Schwung 7 pages, different keys on each) — so a harness that sweeps
 * cells by the view model's names never sees the jog page Schwung's grid. */
let lastOwner: PageOwner | null = null;

export function paramBodyFor(owner: PageOwner, vm: ViewModel,
                             schwungBody: (() => void) | undefined): () => void {
    lastBody = schwungBody ? 'schwung' : 'movy';
    lastOwner = schwungBody ? owner : null;
    if (schwungBody) return schwungBody;
    if (owner.delegated) {
        trips++;
        /* Once per distinct page: this runs per rendered frame, and the log is
         * for finding the site, not for counting frames. */
        const at = owner.ref ? owner.ref.track + ':' + owner.ref.componentKey : '?';
        if (at !== lastTrip) { lastTrip = at; mlog('movy-body-under-page ' + at); }
    }
    return () => drawKnobParams(vm);
}

/** How often movy's body drew over a live Schwung page, and on which. */
export function movyBodyUnderPage(): { count: number; last: string } {
    return { count: trips, last: lastTrip };
}

/** Whose body the most recent param frame drew. */
export function lastParamBody(): 'schwung' | 'movy' { return lastBody; }

/** The Schwung page the last frame drew, read live; null when movy drew it. */
export function lastSchwungPage(): { pageIndex: number; pageCount: number;
                                     keys: (string | null)[] } | null {
    const page = lastOwner && lastOwner.page;
    if (!page) return null;
    const keys: (string | null)[] = [];
    for (let slot = 0; slot < 8; slot++) keys.push(page.keyAt(slot));
    return { pageIndex: page.pageIndex, pageCount: page.pageCount, keys };
}

export function resetMovyBodyUnderPage(): void { trips = 0; lastTrip = ''; }
